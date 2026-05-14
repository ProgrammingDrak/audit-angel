/**
 * The Audit Angel — Express API Server
 *
 * Serves the dashboard as static files and provides:
 *  - REST API for investigations, pins, images, preferences
 *  - Session-based auth (email/password)
 *  - Real-time collaboration via Server-Sent Events
 *  - Migration import from localStorage
 */

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const db = require("./db");
const auth = require("./auth");

const app = express();
const PORT = process.env.PORT || 3456;
const MAX_MARKUP_SOURCE_BYTES = 5 * 1024 * 1024;

// Trust Railway/Heroku/Render proxy so secure cookies work behind HTTPS termination
app.set("trust proxy", 1);

// ── Middleware ──
app.use(express.json({ limit: "10mb" }));

// ── Session Setup ──
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

app.use(session({
  store: new PgSession({ pool: db.pool, tableName: "session" }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: "aa_session",
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: "lax",
  },
}));

// ── SSE Client Tracking ──
const sseClients = new Set(); // { res, userId }

function broadcast(eventType, data, accessCheck) {
  const payload = JSON.stringify({ type: eventType, ...data });
  for (const client of sseClients) {
    if (accessCheck && !accessCheck(client.userId)) continue;
    client.res.write(`data: ${payload}\n\n`);
  }
}

async function broadcastToInvestigation(eventType, invId, data) {
  const payload = JSON.stringify({ type: eventType, investigationId: invId, ...data });
  for (const client of sseClients) {
    const hasAccess = await db.canAccessInvestigation(invId, client.userId);
    if (hasAccess) {
      client.res.write(`data: ${payload}\n\n`);
    }
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function estimateSourceBytes(sourceContent) {
  if (!sourceContent) return 0;
  const match = String(sourceContent).match(/^data:[^;]+;base64,(.*)$/);
  if (match) return Math.floor(match[1].length * 3 / 4);
  return Buffer.byteLength(sourceContent, "utf8");
}

function normalizeMarkupArtifact(row) {
  if (!row) return null;
  if (typeof row.annotations === "string") {
    try { row.annotations = JSON.parse(row.annotations); } catch(e) { row.annotations = []; }
  }
  if (typeof row.page_meta === "string") {
    try { row.page_meta = JSON.parse(row.page_meta); } catch(e) { row.page_meta = {}; }
  }
  row.annotations = Array.isArray(row.annotations) ? row.annotations : [];
  row.page_meta = row.page_meta && typeof row.page_meta === "object" ? row.page_meta : {};
  return row;
}

async function canAccessMarkupArtifact(artifactId, userId) {
  const artifact = normalizeMarkupArtifact(await db.getMarkupArtifact(artifactId));
  if (!artifact) return null;
  if (Number(artifact.created_by) === Number(userId)) return artifact;
  if (!artifact.investigation_id) return null;
  const hasAccess = await db.canAccessInvestigation(artifact.investigation_id, userId);
  return hasAccess ? artifact : null;
}

function markupPinData(artifact) {
  return {
    artifactId: artifact.id,
    sourceType: artifact.source_type,
    sourceName: artifact.source_name,
    sourceMime: artifact.source_mime,
    annotationCount: (artifact.annotations || []).length,
    thumbnailDataUrl: artifact.thumbnail_data_url || "",
  };
}

function validateMarkupSource(sourceType, sourceContent) {
  if (!["html", "pdf", "image"].includes(sourceType)) {
    return "Unsupported source type";
  }
  if (!sourceContent || estimateSourceBytes(sourceContent) > MAX_MARKUP_SOURCE_BYTES) {
    return "Markup source is required and must be 5 MB or smaller";
  }
  return "";
}

async function createMarkupPinForInvestigation(artifact, invId, userId, body) {
  const pinId = body.pinId || "pin_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
  const maxSort = await db.queryOne(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM pins WHERE investigation_id = $1 AND parent_pin_id IS NULL",
    [invId]
  );

  const pin = await db.createPin({
    id: pinId,
    investigation_id: invId,
    parent_pin_id: null,
    created_by: userId,
    type: "markup",
    source: artifact.source_name || "Markup Artifact",
    title: body.title || artifact.source_name || "Markup Artifact",
    note: body.note || "",
    color: null,
    data: markupPinData(artifact),
    filters: {},
    sort_order: body.sort_order != null ? body.sort_order : maxSort.next,
  });

  const attached = normalizeMarkupArtifact(await db.attachMarkupArtifact(artifact.id, invId, pinId));
  pin.data = { ...(pin.data || {}), ...markupPinData(attached) };
  return { pin, artifact: attached };
}

function renderAnnotationSvg(annotations, page) {
  const pageAnnotations = (annotations || []).filter((ann) => Number(ann.page || 0) === page);
  const parts = [];
  for (const ann of pageAnnotations) {
    const id = escapeHtml(ann.id || "");
    const color = escapeHtml(ann.color || "#DC2626");
    const stroke = Math.max(1, Number(ann.strokeWidth || 3));
    const x = Number(ann.x || 0) * 100;
    const y = Number(ann.y || 0) * 100;
    const w = Number(ann.w || 0.18) * 100;
    const h = Number(ann.h || 0.08) * 100;
    const common = `id="ann_${id}" data-ann-id="${id}" class="ann-node"`;
    if (ann.type === "arrow") {
      const x2 = Number(ann.x2 || ann.x || 0) * 100;
      const y2 = Number(ann.y2 || ann.y || 0) * 100;
      parts.push(`<line ${common} x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${stroke}" marker-end="url(#arrowHead)" />`);
    } else if (ann.type === "pen" && Array.isArray(ann.points) && ann.points.length) {
      const d = ann.points.map((pt, idx) => `${idx ? "L" : "M"} ${Number(pt.x || 0) * 100} ${Number(pt.y || 0) * 100}`).join(" ");
      parts.push(`<path ${common} d="${escapeHtml(d)}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" />`);
    } else if (ann.type === "text") {
      parts.push(`<foreignObject ${common} x="${x}" y="${y}" width="${Math.max(w, 14)}" height="${Math.max(h, 7)}"><div xmlns="http://www.w3.org/1999/xhtml" class="ann-text" style="border-color:${color};">${escapeHtml(ann.text || ann.summary || "Note")}</div></foreignObject>`);
    } else {
      const fill = ann.type === "highlight" ? color : "none";
      const opacity = ann.type === "highlight" ? "0.22" : "1";
      parts.push(`<rect ${common} x="${x}" y="${y}" width="${Math.max(w, 1)}" height="${Math.max(h, 1)}" rx="1" fill="${fill}" fill-opacity="${opacity}" stroke="${color}" stroke-width="${stroke}" />`);
    }
  }
  return `<svg class="export-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
    <defs><marker id="arrowHead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#DC2626"></path></marker></defs>
    ${parts.join("")}
  </svg>`;
}

function renderMarkupExport(artifact) {
  artifact = normalizeMarkupArtifact(artifact);
  const annotations = artifact.annotations || [];
  const pageCount = Math.max(1, Number(artifact.page_meta && artifact.page_meta.pageCount) || 1);
  const title = artifact.source_name || "Annotated Artifact";
  let documentHtml = "";

  if (artifact.source_type === "html") {
    documentHtml += `<section class="doc-page" id="page-0"><iframe class="html-frame" sandbox="" srcdoc="${escapeHtml(artifact.source_content)}"></iframe>${renderAnnotationSvg(annotations, 0)}</section>`;
  } else if (artifact.source_type === "image") {
    documentHtml += `<section class="doc-page" id="page-0" style="min-height:0;"><img class="source-image" src="${escapeHtml(artifact.source_content)}" alt="${escapeHtml(title)}">${renderAnnotationSvg(annotations, 0)}</section>`;
  } else {
    for (let i = 0; i < pageCount; i++) {
      documentHtml += `<section class="doc-page pdf-page" id="page-${i}" data-page="${i + 1}"><canvas></canvas>${renderAnnotationSvg(annotations, i)}</section>`;
    }
  }

  const summaryHtml = annotations.length ? annotations.map((ann, idx) => {
    const annId = escapeHtml(ann.id || "");
    const page = Number(ann.page || 0);
    const summary = ann.summary || ann.text || "(No summary provided)";
    return `<article class="summary-item" id="summary_${annId}" data-ann-id="${annId}">
      <div class="summary-meta">Annotation ${idx + 1} · ${escapeHtml(ann.type || "marker")} · Page ${page + 1}</div>
      <p>${escapeHtml(summary)}</p>
      <a href="#ann_${annId}" onclick="viewAnnotation('${annId}', ${page});return false;">View in document</a>
    </article>`;
  }).join("") : `<div class="empty">No annotations yet.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} - Annotated Review</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<style>
body{margin:0;background:#f6f7f9;color:#161E26;font-family:Arial,sans-serif;}
header{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid #ddd;padding:14px 20px;display:flex;align-items:center;gap:12px;}
h1{font-size:18px;margin:0;flex:1}.tabs{display:flex;gap:8px}.tabs button{border:1px solid #ccd2dc;background:#fff;border-radius:6px;padding:7px 12px;cursor:pointer}.tabs button.active{background:#0075EB;color:#fff;border-color:#0075EB}
.view{display:none;padding:20px}.view.active{display:block}.doc-wrap{max-width:1100px;margin:0 auto}.doc-page{position:relative;background:#fff;border:1px solid #ddd;margin:0 auto 18px;min-height:620px;box-shadow:0 8px 24px rgba(15,23,42,.08)}.html-frame{width:100%;height:760px;border:0}.source-image{display:block;max-width:100%;margin:0 auto}.pdf-page canvas{display:block;width:100%}.export-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:auto}.ann-node{cursor:pointer}.ann-node.active{filter:drop-shadow(0 0 6px #0075EB)}.ann-text{background:#fff;border:2px solid #DC2626;border-radius:4px;padding:6px;font-size:13px;line-height:1.35;box-sizing:border-box;height:100%;overflow:hidden}
.summary-list{max-width:860px;margin:0 auto}.summary-item{background:#fff;border:1px solid #ddd;border-left:4px solid #0075EB;border-radius:8px;padding:16px;margin-bottom:12px}.summary-item.active{box-shadow:0 0 0 3px rgba(0,117,235,.18)}.summary-meta{font-size:12px;color:#657184;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.summary-item a{font-size:13px;font-weight:700;color:#0075EB}.empty{text-align:center;color:#657184;padding:40px}
</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1><div class="tabs"><button id="tabDoc" class="active" onclick="switchTab('doc')">Annotated Document</button><button id="tabSummary" onclick="switchTab('summary')">Summary</button></div></header>
<main id="viewDoc" class="view active"><div class="doc-wrap">${documentHtml}</div></main>
<main id="viewSummary" class="view"><div class="summary-list">${summaryHtml}</div></main>
<script>
var artifact=${safeJson({ sourceType: artifact.source_type, sourceContent: artifact.source_content })};
function switchTab(tab){document.getElementById('viewDoc').classList.toggle('active',tab==='doc');document.getElementById('viewSummary').classList.toggle('active',tab==='summary');document.getElementById('tabDoc').classList.toggle('active',tab==='doc');document.getElementById('tabSummary').classList.toggle('active',tab==='summary');}
function clearActive(){document.querySelectorAll('.active.ann-node,.summary-item.active').forEach(function(el){el.classList.remove('active');});}
function selectAnnotation(id){clearActive();var ann=document.getElementById('ann_'+id);var sum=document.getElementById('summary_'+id);if(ann)ann.classList.add('active');if(sum)sum.classList.add('active');}
function viewAnnotation(id,page){switchTab('doc');setTimeout(function(){selectAnnotation(id);var ann=document.getElementById('ann_'+id)||document.getElementById('page_'+page);if(ann)ann.scrollIntoView({behavior:'smooth',block:'center'});},50);}
document.addEventListener('click',function(e){var ann=e.target.closest&&e.target.closest('.ann-node');if(ann){var id=ann.getAttribute('data-ann-id');selectAnnotation(id);var sum=document.getElementById('summary_'+id);if(sum){setTimeout(function(){switchTab('summary');sum.scrollIntoView({behavior:'smooth',block:'center'});},150);}}});
if(artifact.sourceType==='pdf'&&window.pdfjsLib){pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';pdfjsLib.getDocument(artifact.sourceContent).promise.then(function(pdf){document.querySelectorAll('.pdf-page').forEach(function(pageEl){var n=Number(pageEl.dataset.page);pdf.getPage(n).then(function(page){var viewport=page.getViewport({scale:1.4});var canvas=pageEl.querySelector('canvas');var ctx=canvas.getContext('2d');canvas.width=viewport.width;canvas.height=viewport.height;pageEl.style.width=viewport.width+'px';pageEl.style.minHeight=viewport.height+'px';page.render({canvasContext:ctx,viewport:viewport});});});});}
</script>
</body>
</html>`;
}

// ── Auth Middleware ──
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Not authenticated" });
  res.redirect("/login");
}

// ── Public Routes ──
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "audit-angel", timestamp: new Date().toISOString() });
});

// ── Auth Routes ──
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, displayName, password } = req.body;
    if (!email || !displayName || !password) {
      return res.status(400).json({ error: "Email, display name, and password required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    const existing = await db.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }
    const user = await auth.registerUser(email, displayName, password);
    req.session.userId = user.id;
    res.json({ ok: true, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) {
    console.error("[auth] Register error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const user = await db.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const valid = await auth.verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    req.session.userId = user.id;
    res.json({ ok: true, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) {
    console.error("[auth] Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("aa_session");
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await db.findUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: "User not found" });
  res.json({ id: user.id, email: user.email, displayName: user.display_name });
});

// ── All routes below require auth ──
app.use(requireAuth);

// ── SSE Endpoint ──
app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const client = { res, userId: req.session.userId };
  sseClients.add(client);

  req.on("close", () => {
    sseClients.delete(client);
  });
});

// ── Investigation Routes ──
app.get("/api/investigations", async (req, res) => {
  try {
    const investigations = await db.getInvestigationsForUser(req.session.userId);
    res.json(investigations);
  } catch (err) {
    console.error("[api] List investigations error:", err);
    res.status(500).json({ error: "Failed to list investigations" });
  }
});

app.post("/api/investigations", async (req, res) => {
  try {
    const { id, name } = req.body;
    if (!name) return res.status(400).json({ error: "Name required" });
    const invId = id || "inv_" + Date.now();
    const inv = await db.createInvestigation(invId, req.session.userId, name);
    broadcastToInvestigation("investigation-created", invId, {
      investigation: inv,
      _clientId: req.body._clientId,
    });
    res.json(inv);
  } catch (err) {
    console.error("[api] Create investigation error:", err);
    res.status(500).json({ error: "Failed to create investigation" });
  }
});

app.get("/api/investigations/:id", async (req, res) => {
  try {
    const hasAccess = await db.canAccessInvestigation(req.params.id, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });
    const inv = await db.getInvestigation(req.params.id);
    if (!inv) return res.status(404).json({ error: "Not found" });
    // Include pins with images for the report modal
    const pins = await db.getPinsForInvestigation(req.params.id);
    for (const pin of pins) {
      pin.images = await db.getImagesForPin(pin.id);
      if (typeof pin.data === "string") try { pin.data = JSON.parse(pin.data); } catch(e) {}
      if (pin.type === "markup") {
        const artifact = normalizeMarkupArtifact(await db.getMarkupArtifactByPin(pin.id));
        if (artifact) {
          pin.data = { ...(pin.data || {}), ...markupPinData(artifact) };
        }
      }
    }
    inv.pins = pins;
    res.json(inv);
  } catch (err) {
    console.error("[api] Get investigation error:", err);
    res.status(500).json({ error: "Failed to get investigation" });
  }
});

app.patch("/api/investigations/:id", async (req, res) => {
  try {
    const hasAccess = await db.canAccessInvestigation(req.params.id, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });
    const updated = await db.updateInvestigation(req.params.id, req.body);
    if (!updated) return res.status(400).json({ error: "No valid fields to update" });
    broadcastToInvestigation("investigation-updated", req.params.id, {
      investigation: updated,
      _clientId: req.body._clientId,
    });
    res.json(updated);
  } catch (err) {
    console.error("[api] Update investigation error:", err);
    res.status(500).json({ error: "Failed to update investigation" });
  }
});

app.delete("/api/investigations/:id", async (req, res) => {
  try {
    const isOwner = await db.isInvestigationOwner(req.params.id, req.session.userId);
    if (!isOwner) return res.status(403).json({ error: "Only the owner can delete" });
    await db.deleteInvestigation(req.params.id);
    broadcastToInvestigation("investigation-deleted", req.params.id, {
      _clientId: req.body._clientId,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] Delete investigation error:", err);
    res.status(500).json({ error: "Failed to delete investigation" });
  }
});

// ── Investigation Members ──
app.get("/api/investigations/:id/members", async (req, res) => {
  try {
    const hasAccess = await db.canAccessInvestigation(req.params.id, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });
    const members = await db.getMembers(req.params.id);
    res.json(members);
  } catch (err) {
    console.error("[api] List members error:", err);
    res.status(500).json({ error: "Failed to list members" });
  }
});

app.post("/api/investigations/:id/members", async (req, res) => {
  try {
    const isOwner = await db.isInvestigationOwner(req.params.id, req.session.userId);
    if (!isOwner) return res.status(403).json({ error: "Only the owner can invite members" });
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const user = await db.findUserByEmail(email);
    if (!user) return res.status(404).json({ error: "User not found — they must register first" });
    const member = await db.addMember(req.params.id, user.id, role);
    broadcastToInvestigation("member-added", req.params.id, {
      member: { id: user.id, email: user.email, display_name: user.display_name, role: role || "editor" },
      _clientId: req.body._clientId,
    });
    res.json(member);
  } catch (err) {
    console.error("[api] Add member error:", err);
    res.status(500).json({ error: "Failed to add member" });
  }
});

app.delete("/api/investigations/:id/members/:userId", async (req, res) => {
  try {
    const isOwner = await db.isInvestigationOwner(req.params.id, req.session.userId);
    if (!isOwner) return res.status(403).json({ error: "Only the owner can remove members" });
    await db.removeMember(req.params.id, parseInt(req.params.userId));
    broadcastToInvestigation("member-removed", req.params.id, {
      removedUserId: parseInt(req.params.userId),
      _clientId: req.body._clientId,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] Remove member error:", err);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

// ── Pin Routes ──
app.get("/api/investigations/:id/pins", async (req, res) => {
  try {
    const hasAccess = await db.canAccessInvestigation(req.params.id, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });
    const pins = await db.getPinsForInvestigation(req.params.id);
    res.json(pins);
  } catch (err) {
    console.error("[api] List pins error:", err);
    res.status(500).json({ error: "Failed to list pins" });
  }
});

app.post("/api/investigations/:id/pins", async (req, res) => {
  try {
    const hasAccess = await db.canAccessInvestigation(req.params.id, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    const pinId = req.body.id || "pin_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
    const maxSort = await db.queryOne(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM pins WHERE investigation_id = $1 AND parent_pin_id IS NULL",
      [req.params.id]
    );

    const pin = await db.createPin({
      id: pinId,
      investigation_id: req.params.id,
      parent_pin_id: req.body.parent_pin_id || null,
      created_by: req.session.userId,
      type: req.body.type,
      source: req.body.source,
      title: req.body.title,
      note: req.body.note,
      color: req.body.color,
      data: req.body.data,
      filters: req.body.filters,
      sort_order: req.body.sort_order != null ? req.body.sort_order : maxSort.next,
    });

    // Handle inline images
    if (req.body.images && Array.isArray(req.body.images)) {
      for (let i = 0; i < req.body.images.length; i++) {
        const img = req.body.images[i];
        await db.addImage(pinId, img.dataUrl || img.data_url, img.caption, img.link);
      }
    }

    broadcastToInvestigation("pin-added", req.params.id, {
      pin,
      _clientId: req.body._clientId,
    });
    res.json(pin);
  } catch (err) {
    console.error("[api] Create pin error:", err);
    res.status(500).json({ error: "Failed to create pin" });
  }
});

app.post("/api/pins/:pinId/children", async (req, res) => {
  try {
    const invId = await db.getPinInvestigationId(req.params.pinId);
    if (!invId) return res.status(404).json({ error: "Parent pin not found" });
    const hasAccess = await db.canAccessInvestigation(invId, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    const childId = req.body.id || "pin_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
    const maxSort = await db.queryOne(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM pins WHERE parent_pin_id = $1",
      [req.params.pinId]
    );

    const child = await db.createPin({
      id: childId,
      investigation_id: invId,
      parent_pin_id: req.params.pinId,
      created_by: req.session.userId,
      type: req.body.type,
      source: req.body.source,
      title: req.body.title,
      note: req.body.note,
      color: req.body.color,
      data: req.body.data,
      filters: req.body.filters,
      sort_order: maxSort.next,
    });

    broadcastToInvestigation("pin-added", invId, {
      pin: child,
      _clientId: req.body._clientId,
    });
    res.json(child);
  } catch (err) {
    console.error("[api] Create child pin error:", err);
    res.status(500).json({ error: "Failed to create child pin" });
  }
});

app.patch("/api/pins/:pinId", async (req, res) => {
  try {
    const invId = await db.getPinInvestigationId(req.params.pinId);
    if (!invId) return res.status(404).json({ error: "Pin not found" });
    const hasAccess = await db.canAccessInvestigation(invId, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    const updated = await db.updatePin(req.params.pinId, req.body);
    if (!updated) return res.status(400).json({ error: "No valid fields to update" });

    broadcastToInvestigation("pin-updated", invId, {
      pin: updated,
      _clientId: req.body._clientId,
    });
    res.json(updated);
  } catch (err) {
    console.error("[api] Update pin error:", err);
    res.status(500).json({ error: "Failed to update pin" });
  }
});

app.delete("/api/pins/:pinId", async (req, res) => {
  try {
    const invId = await db.getPinInvestigationId(req.params.pinId);
    if (!invId) return res.status(404).json({ error: "Pin not found" });
    const hasAccess = await db.canAccessInvestigation(invId, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    await db.deletePin(req.params.pinId);

    broadcastToInvestigation("pin-removed", invId, {
      pinId: req.params.pinId,
      _clientId: req.body._clientId,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] Delete pin error:", err);
    res.status(500).json({ error: "Failed to delete pin" });
  }
});

app.post("/api/investigations/:id/pins/reorder", async (req, res) => {
  try {
    const hasAccess = await db.canAccessInvestigation(req.params.id, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });
    if (!req.body.items || !Array.isArray(req.body.items)) {
      return res.status(400).json({ error: "items array required" });
    }
    await db.reorderPins(req.params.id, req.body.items);
    broadcastToInvestigation("pin-reordered", req.params.id, {
      items: req.body.items,
      _clientId: req.body._clientId,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] Reorder pins error:", err);
    res.status(500).json({ error: "Failed to reorder pins" });
  }
});

app.post("/api/pins/:pinId/move", async (req, res) => {
  try {
    const fromInvId = await db.getPinInvestigationId(req.params.pinId);
    if (!fromInvId) return res.status(404).json({ error: "Pin not found" });
    const toInvestigationId = req.body.toInvestigationId || req.body.target_investigation_id;
    const hasAccessFrom = await db.canAccessInvestigation(fromInvId, req.session.userId);
    const hasAccessTo = await db.canAccessInvestigation(toInvestigationId, req.session.userId);
    if (!hasAccessFrom || !hasAccessTo) return res.status(403).json({ error: "Access denied" });

    const moved = await db.movePin(req.params.pinId, toInvestigationId);

    broadcastToInvestigation("pin-moved", fromInvId, {
      pinId: req.params.pinId,
      toInvestigationId,
      _clientId: req.body._clientId,
    });
    broadcastToInvestigation("pin-added", toInvestigationId, {
      pin: moved,
      _clientId: req.body._clientId,
    });
    res.json(moved);
  } catch (err) {
    console.error("[api] Move pin error:", err);
    res.status(500).json({ error: "Failed to move pin" });
  }
});

app.post("/api/pins/:pinId/copy", async (req, res) => {
  try {
    const fromInvId = await db.getPinInvestigationId(req.params.pinId);
    if (!fromInvId) return res.status(404).json({ error: "Pin not found" });
    const toInvestigationId = req.body.toInvestigationId || req.body.target_investigation_id;
    const hasAccessFrom = await db.canAccessInvestigation(fromInvId, req.session.userId);
    const hasAccessTo = await db.canAccessInvestigation(toInvestigationId, req.session.userId);
    if (!hasAccessFrom || !hasAccessTo) return res.status(403).json({ error: "Access denied" });

    const newPinId = "pin_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
    const copied = await db.copyPin(req.params.pinId, toInvestigationId, newPinId, req.session.userId);

    broadcastToInvestigation("pin-added", toInvestigationId, {
      pin: copied,
      _clientId: req.body._clientId,
    });
    res.json(copied);
  } catch (err) {
    console.error("[api] Copy pin error:", err);
    res.status(500).json({ error: "Failed to copy pin" });
  }
});

// ── Markup Artifacts ──
app.post("/api/investigations/:id/markup-artifacts", async (req, res) => {
  try {
    const hasAccess = await db.canAccessInvestigation(req.params.id, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    const { sourceType, sourceName, sourceMime, sourceContent, title, note } = req.body;
    const validationError = validateMarkupSource(sourceType, sourceContent);
    if (validationError) return res.status(400).json({ error: validationError });

    const artifactId = req.body.id || "markup_" + Date.now() + "_" + Math.random().toString(36).substr(2, 8);
    const artifact = normalizeMarkupArtifact(await db.createMarkupArtifact({
      id: artifactId,
      investigation_id: null,
      pin_id: null,
      created_by: req.session.userId,
      source_type: sourceType,
      source_name: sourceName || "",
      source_mime: sourceMime || "",
      source_content: sourceContent,
      annotations: [],
      page_meta: { pageCount: 1 },
      thumbnail_data_url: "",
    }));

    const { pin, artifact: attached } = await createMarkupPinForInvestigation(artifact, req.params.id, req.session.userId, {
      pinId: req.body.pinId,
      title,
      note,
    });
    broadcastToInvestigation("pin-added", req.params.id, {
      pin,
      _clientId: req.body._clientId,
    });
    res.json({ pin, artifact: attached });
  } catch (err) {
    console.error("[api] Create markup artifact error:", err);
    res.status(500).json({ error: "Failed to create markup artifact" });
  }
});

app.get("/api/markup-artifacts", async (req, res) => {
  try {
    if (req.query.standalone !== "1") return res.status(400).json({ error: "Unsupported markup artifact query" });
    const artifacts = (await db.getStandaloneMarkupArtifactsForUser(req.session.userId)).map(normalizeMarkupArtifact);
    res.json(artifacts);
  } catch (err) {
    console.error("[api] List markup artifacts error:", err);
    res.status(500).json({ error: "Failed to list markup artifacts" });
  }
});

app.post("/api/markup-artifacts", async (req, res) => {
  try {
    const { sourceType, sourceName, sourceMime, sourceContent } = req.body;
    const validationError = validateMarkupSource(sourceType, sourceContent);
    if (validationError) return res.status(400).json({ error: validationError });

    const artifactId = req.body.id || "markup_" + Date.now() + "_" + Math.random().toString(36).substr(2, 8);
    const artifact = normalizeMarkupArtifact(await db.createMarkupArtifact({
      id: artifactId,
      investigation_id: null,
      pin_id: null,
      created_by: req.session.userId,
      source_type: sourceType,
      source_name: sourceName || "",
      source_mime: sourceMime || "",
      source_content: sourceContent,
      annotations: [],
      page_meta: { pageCount: 1 },
      thumbnail_data_url: "",
    }));

    res.json({ artifact });
  } catch (err) {
    console.error("[api] Create standalone markup artifact error:", err);
    res.status(500).json({ error: "Failed to create markup artifact" });
  }
});

app.get("/api/markup-artifacts/:artifactId", async (req, res) => {
  try {
    const artifact = await canAccessMarkupArtifact(req.params.artifactId, req.session.userId);
    if (!artifact) return res.status(404).json({ error: "Markup artifact not found" });
    res.json(artifact);
  } catch (err) {
    console.error("[api] Get markup artifact error:", err);
    res.status(500).json({ error: "Failed to get markup artifact" });
  }
});

app.post("/api/markup-artifacts/:artifactId/attach", async (req, res) => {
  try {
    const artifact = await canAccessMarkupArtifact(req.params.artifactId, req.session.userId);
    if (!artifact) return res.status(404).json({ error: "Markup artifact not found" });
    if (artifact.pin_id || artifact.investigation_id) {
      return res.status(409).json({ error: "Markup artifact is already attached" });
    }

    let investigation = null;
    let invId = req.body.investigationId || req.body.investigation_id || req.body.targetInvestigationId;
    const createName = (req.body.createInvestigationName || "").trim();

    if (createName) {
      invId = req.body.newInvestigationId || "inv_" + Date.now();
      investigation = await db.createInvestigation(invId, req.session.userId, createName);
      broadcastToInvestigation("investigation-created", invId, {
        investigation,
        _clientId: req.body._clientId,
      });
    } else {
      if (!invId) return res.status(400).json({ error: "Investigation is required" });
      const hasAccess = await db.canAccessInvestigation(invId, req.session.userId);
      if (!hasAccess) return res.status(403).json({ error: "Access denied" });
    }

    const { pin, artifact: attached } = await createMarkupPinForInvestigation(artifact, invId, req.session.userId, req.body);
    broadcastToInvestigation("pin-added", invId, {
      pin,
      _clientId: req.body._clientId,
    });
    res.json({ pin, artifact: attached, investigation });
  } catch (err) {
    console.error("[api] Attach markup artifact error:", err);
    res.status(500).json({ error: "Failed to attach markup artifact" });
  }
});

app.patch("/api/markup-artifacts/:artifactId", async (req, res) => {
  try {
    const artifact = await canAccessMarkupArtifact(req.params.artifactId, req.session.userId);
    if (!artifact) return res.status(404).json({ error: "Markup artifact not found" });

    const updated = normalizeMarkupArtifact(await db.updateMarkupArtifact(req.params.artifactId, {
      annotations: Array.isArray(req.body.annotations) ? req.body.annotations : artifact.annotations,
      page_meta: req.body.page_meta || req.body.pageMeta || artifact.page_meta,
      thumbnail_data_url: req.body.thumbnail_data_url || req.body.thumbnailDataUrl || artifact.thumbnail_data_url || "",
    }));

    if (artifact.pin_id) {
      await db.updatePinData(artifact.pin_id, markupPinData(updated));
    }
    if (artifact.investigation_id) {
      broadcastToInvestigation("pin-updated", artifact.investigation_id, {
        pinId: artifact.pin_id,
        markupUpdated: true,
        _clientId: req.body._clientId,
      });
    }
    res.json(updated);
  } catch (err) {
    console.error("[api] Update markup artifact error:", err);
    res.status(500).json({ error: "Failed to update markup artifact" });
  }
});

app.get("/api/markup-artifacts/:artifactId/export", async (req, res) => {
  try {
    const artifact = await canAccessMarkupArtifact(req.params.artifactId, req.session.userId);
    if (!artifact) return res.status(404).json({ error: "Markup artifact not found" });
    const filename = (artifact.source_name || "annotated-artifact").replace(/[^a-zA-Z0-9 _.-]/g, "").replace(/\s+/g, "-").toLowerCase();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename || "annotated-artifact"}-review.html"`);
    res.send(renderMarkupExport(artifact));
  } catch (err) {
    console.error("[api] Export markup artifact error:", err);
    res.status(500).json({ error: "Failed to export markup artifact" });
  }
});

// ── Pin Images ──
app.get("/api/pins/:pinId/images", async (req, res) => {
  try {
    const invId = await db.getPinInvestigationId(req.params.pinId);
    if (!invId) return res.status(404).json({ error: "Pin not found" });
    const hasAccess = await db.canAccessInvestigation(invId, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });
    const images = await db.getImagesForPin(req.params.pinId);
    res.json(images);
  } catch (err) {
    console.error("[api] List images error:", err);
    res.status(500).json({ error: "Failed to list images" });
  }
});

app.post("/api/pins/:pinId/images", async (req, res) => {
  try {
    const invId = await db.getPinInvestigationId(req.params.pinId);
    if (!invId) return res.status(404).json({ error: "Pin not found" });
    const hasAccess = await db.canAccessInvestigation(invId, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });
    if (!req.body.data_url) return res.status(400).json({ error: "data_url required" });
    const image = await db.addImage(req.params.pinId, req.body.data_url, req.body.caption, req.body.link);
    broadcastToInvestigation("pin-updated", invId, {
      pinId: req.params.pinId,
      imageAdded: true,
      _clientId: req.body._clientId,
    });
    res.json(image);
  } catch (err) {
    console.error("[api] Add image error:", err);
    res.status(500).json({ error: "Failed to add image" });
  }
});

app.delete("/api/images/:imageId", async (req, res) => {
  try {
    // Look up the pin to check access
    const img = await db.queryOne("SELECT pin_id FROM pin_images WHERE id = $1", [req.params.imageId]);
    if (!img) return res.status(404).json({ error: "Image not found" });
    const invId = await db.getPinInvestigationId(img.pin_id);
    const hasAccess = await db.canAccessInvestigation(invId, req.session.userId);
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });
    await db.deleteImage(req.params.imageId);
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] Delete image error:", err);
    res.status(500).json({ error: "Failed to delete image" });
  }
});

// ── Dismissed Anomalies ──
app.get("/api/dismissed-anomalies", async (req, res) => {
  try {
    const rows = await db.getDismissedAnomalies(req.session.userId);
    const map = {};
    for (const r of rows) map[r.anomaly_key] = { note: r.note, dismissedAt: r.dismissed_at };
    res.json(map);
  } catch (err) {
    console.error("[api] Get dismissed error:", err);
    res.status(500).json({ error: "Failed to get dismissed anomalies" });
  }
});

app.put("/api/dismissed-anomalies/:key(*)", async (req, res) => {
  try {
    const result = await db.dismissAnomaly(req.session.userId, req.params.key, req.body.note);
    res.json(result);
  } catch (err) {
    console.error("[api] Dismiss anomaly error:", err);
    res.status(500).json({ error: "Failed to dismiss anomaly" });
  }
});

app.delete("/api/dismissed-anomalies/:key(*)", async (req, res) => {
  try {
    await db.restoreAnomaly(req.session.userId, req.params.key);
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] Restore anomaly error:", err);
    res.status(500).json({ error: "Failed to restore anomaly" });
  }
});

// ── Bonus Config ──
app.get("/api/bonus-config", async (req, res) => {
  try {
    const config = await db.getBonusConfig(req.session.userId);
    res.json(config);
  } catch (err) {
    console.error("[api] Get bonus config error:", err);
    res.status(500).json({ error: "Failed to get bonus config" });
  }
});

app.put("/api/bonus-config", async (req, res) => {
  try {
    if (!req.body.config) return res.status(400).json({ error: "config required" });
    const result = await db.saveBonusConfig(req.session.userId, req.body.config);
    res.json(result);
  } catch (err) {
    console.error("[api] Save bonus config error:", err);
    res.status(500).json({ error: "Failed to save bonus config" });
  }
});

// ── User Preferences ──
app.get("/api/preferences", async (req, res) => {
  try {
    const prefs = await db.getPreferences(req.session.userId);
    res.json(prefs);
  } catch (err) {
    console.error("[api] Get preferences error:", err);
    res.status(500).json({ error: "Failed to get preferences" });
  }
});

app.put("/api/preferences/:key", async (req, res) => {
  try {
    if (req.body.value === undefined) return res.status(400).json({ error: "value required" });
    const result = await db.setPreference(req.session.userId, req.params.key, req.body.value);
    res.json(result);
  } catch (err) {
    console.error("[api] Set preference error:", err);
    res.status(500).json({ error: "Failed to set preference" });
  }
});

// ── Migration Import ──
app.post("/api/migrate/import", async (req, res) => {
  try {
    const userId = req.session.userId;
    const { investigations, dismissedAnomalies, bonusConfig, favFilters, tabFilterPrefs, dashOverride } = req.body;
    const counts = { investigations: 0, pins: 0, images: 0 };

    // Import investigations + pins + images
    if (investigations && Array.isArray(investigations)) {
      for (const inv of investigations) {
        // Skip if already exists
        const existing = await db.getInvestigation(inv.id);
        if (existing) continue;

        await db.createInvestigation(inv.id, userId, inv.name);
        if (inv.summary || inv.hypothesis || inv.nextStep || inv.completedAt) {
          await db.updateInvestigation(inv.id, {
            summary: inv.summary || "",
            hypothesis: inv.hypothesis || "",
            next_step: inv.nextStep || "",
            completed_at: inv.completedAt || null,
          });
        }
        counts.investigations++;

        if (inv.pins && Array.isArray(inv.pins)) {
          for (let i = 0; i < inv.pins.length; i++) {
            const pin = inv.pins[i];
            const pinId = pin.id || "pin_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
            await db.createPin({
              id: pinId,
              investigation_id: inv.id,
              parent_pin_id: null,
              created_by: userId,
              type: pin.type || "item",
              source: pin.source || "",
              title: pin.title || "(untitled)",
              note: pin.note || "",
              color: pin.color || null,
              data: pin.data || {},
              filters: pin.filters || {},
              sort_order: i,
            });
            counts.pins++;

            // Import pin images
            if (pin.images && Array.isArray(pin.images)) {
              for (const img of pin.images) {
                if (img.dataUrl) {
                  await db.addImage(pinId, img.dataUrl, img.caption || "", img.link || "");
                  counts.images++;
                }
              }
            }

            // Import children
            if (pin.children && Array.isArray(pin.children)) {
              for (let j = 0; j < pin.children.length; j++) {
                const child = pin.children[j];
                const childId = child.id || "pin_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
                await db.createPin({
                  id: childId,
                  investigation_id: inv.id,
                  parent_pin_id: pinId,
                  created_by: userId,
                  type: child.type || "item",
                  source: child.source || "",
                  title: child.title || "(untitled)",
                  note: child.note || "",
                  color: child.color || null,
                  data: child.data || {},
                  filters: child.filters || {},
                  sort_order: j,
                });
                counts.pins++;

                if (child.images && Array.isArray(child.images)) {
                  for (const img of child.images) {
                    if (img.dataUrl) {
                      await db.addImage(childId, img.dataUrl, img.caption || "", img.link || "");
                      counts.images++;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Import dismissed anomalies
    if (dismissedAnomalies && typeof dismissedAnomalies === "object") {
      for (const [key, val] of Object.entries(dismissedAnomalies)) {
        await db.dismissAnomaly(userId, key, val.note || "");
      }
    }

    // Import bonus config
    if (bonusConfig) {
      await db.saveBonusConfig(userId, bonusConfig);
    }

    // Import preferences
    if (favFilters) await db.setPreference(userId, "fav_filters", favFilters);
    if (tabFilterPrefs) await db.setPreference(userId, "tab_filter_prefs", tabFilterPrefs);
    if (dashOverride !== undefined) await db.setPreference(userId, "dash_override", dashOverride);

    console.log(`[migrate] Imported for user ${userId}:`, counts);
    res.json({ ok: true, counts });
  } catch (err) {
    console.error("[migrate] Import error:", err);
    res.status(500).json({ error: "Migration failed: " + err.message });
  }
});

// ── Export / Import (JSON) ──
app.get("/api/export/json", requireAuth, async (req, res) => {
  try {
    const investigations = await db.getInvestigationsForUser(req.session.userId);
    const full = [];
    for (const inv of investigations) {
      const detail = await db.getInvestigation(inv.id);
      full.push(detail);
    }
    res.json({ investigations: full });
  } catch (err) {
    console.error("[api] Export error:", err);
    res.status(500).json({ error: "Export failed" });
  }
});

app.post("/api/import/json", requireAuth, async (req, res) => {
  try {
    const data = req.body;
    const investigations = data.investigations || data;
    if (!Array.isArray(investigations)) return res.status(400).json({ error: "Invalid format" });
    let imported = 0;
    for (const inv of investigations) {
      const invId = inv.id || "inv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      try {
        await db.createInvestigation(invId, req.session.userId, inv.name || "Imported");
        if (inv.summary) await db.updateInvestigation(invId, { summary: inv.summary });
        const pins = inv.pins || [];
        for (const pin of pins) {
          const pinId = pin.id || "pin_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
          await db.createPin({
            id: pinId, investigation_id: invId, created_by: req.session.userId,
            type: pin.type || "note", source: pin.source || "", title: pin.title || "",
            note: pin.note || "", color: pin.color || null,
            data: pin.data ? JSON.stringify(pin.data) : "{}",
          });
          const images = pin.images || [];
          for (const img of images) {
            await db.addImage(pinId, img.data_url || img.dataUrl, img.caption || "", img.link || "");
          }
        }
        imported++;
      } catch (e) { /* skip duplicates */ }
    }
    res.json({ ok: true, imported });
  } catch (err) {
    console.error("[api] Import error:", err);
    res.status(500).json({ error: "Import failed" });
  }
});

// ── Static File Serving ──
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback — serve index.html for all non-API routes
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start Server ──
async function start() {
  try {
    await db.initDB();
    await auth.ensureDefaultUser();
    app.listen(PORT, () => {
      console.log(`[audit-angel] Server running on port ${PORT}`);
      console.log(`[audit-angel] Dashboard: http://localhost:${PORT}/`);
      console.log(`[audit-angel] Health: http://localhost:${PORT}/api/health`);
    });
  } catch (err) {
    console.error("[audit-angel] Failed to start:", err);
    process.exit(1);
  }
}

start();
