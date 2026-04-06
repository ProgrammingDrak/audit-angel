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
    const hasAccessFrom = await db.canAccessInvestigation(fromInvId, req.session.userId);
    const hasAccessTo = await db.canAccessInvestigation(req.body.toInvestigationId, req.session.userId);
    if (!hasAccessFrom || !hasAccessTo) return res.status(403).json({ error: "Access denied" });

    const moved = await db.movePin(req.params.pinId, req.body.toInvestigationId);

    broadcastToInvestigation("pin-moved", fromInvId, {
      pinId: req.params.pinId,
      toInvestigationId: req.body.toInvestigationId,
      _clientId: req.body._clientId,
    });
    broadcastToInvestigation("pin-added", req.body.toInvestigationId, {
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
    const hasAccessFrom = await db.canAccessInvestigation(fromInvId, req.session.userId);
    const hasAccessTo = await db.canAccessInvestigation(req.body.toInvestigationId, req.session.userId);
    if (!hasAccessFrom || !hasAccessTo) return res.status(403).json({ error: "Access denied" });

    const newPinId = "pin_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
    const copied = await db.copyPin(req.params.pinId, req.body.toInvestigationId, newPinId, req.session.userId);

    broadcastToInvestigation("pin-added", req.body.toInvestigationId, {
      pin: copied,
      _clientId: req.body._clientId,
    });
    res.json(copied);
  } catch (err) {
    console.error("[api] Copy pin error:", err);
    res.status(500).json({ error: "Failed to copy pin" });
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

// ── Static File Serving ──
// Serve the dashboard at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "the-audit-angel.html"));
});

// Serve manifest and embedded dashboards
app.use(express.static(__dirname, {
  index: false, // Don't auto-serve index.html
  dotfiles: "ignore",
}));

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
