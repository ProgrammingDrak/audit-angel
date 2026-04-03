const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
const DB_PATH = path.join(__dirname, 'data', 'audit-angel.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run migrations
const migrationFile = path.join(__dirname, 'migrations', '001-init.sql');
const migrationSQL = fs.readFileSync(migrationFile, 'utf8');
db.exec(migrationSQL);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function generateId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// INVESTIGATIONS
// ---------------------------------------------------------------------------

// List all investigations with pin counts
app.get('/api/investigations', (req, res) => {
  const rows = db.prepare(`
    SELECT i.*,
      (SELECT COUNT(*) FROM pins p WHERE p.investigation_id = i.id AND p.parent_pin_id IS NULL) AS pin_count
    FROM investigations i
    ORDER BY i.completed_at IS NOT NULL, i.created DESC
  `).all();
  res.json(rows);
});

// Get single investigation with all pins + images
app.get('/api/investigations/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM investigations WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const pins = db.prepare(`
    SELECT * FROM pins WHERE investigation_id = ? ORDER BY sort_order, pinned_at
  `).all(req.params.id);

  const imagesByPin = {};
  const allImages = db.prepare(`
    SELECT pi.* FROM pin_images pi
    JOIN pins p ON pi.pin_id = p.id
    WHERE p.investigation_id = ?
    ORDER BY pi.sort_order, pi.added_at
  `).all(req.params.id);

  for (const img of allImages) {
    if (!imagesByPin[img.pin_id]) imagesByPin[img.pin_id] = [];
    imagesByPin[img.pin_id].push(img);
  }

  // Build hierarchical pin structure
  const topLevel = [];
  const byId = {};
  for (const pin of pins) {
    pin.images = imagesByPin[pin.id] || [];
    pin.data = JSON.parse(pin.data || '{}');
    pin.filters = JSON.parse(pin.filters || '{}');
    pin.children = [];
    byId[pin.id] = pin;
  }
  for (const pin of pins) {
    if (pin.parent_pin_id && byId[pin.parent_pin_id]) {
      byId[pin.parent_pin_id].children.push(pin);
    } else {
      topLevel.push(pin);
    }
  }

  inv.pins = topLevel;
  res.json(inv);
});

// Create investigation
app.post('/api/investigations', (req, res) => {
  const id = generateId('inv');
  const { name } = req.body;
  const created = now();
  db.prepare(`
    INSERT INTO investigations (id, name, created) VALUES (?, ?, ?)
  `).run(id, name || 'New Investigation', created);
  const inv = db.prepare('SELECT * FROM investigations WHERE id = ?').get(id);
  res.status(201).json(inv);
});

// Update investigation
app.put('/api/investigations/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM investigations WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const fields = ['name', 'summary', 'hypothesis', 'next_step'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (updates.length) {
    values.push(req.params.id);
    db.prepare(`UPDATE investigations SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  res.json(db.prepare('SELECT * FROM investigations WHERE id = ?').get(req.params.id));
});

// Delete investigation
app.delete('/api/investigations/:id', (req, res) => {
  const result = db.prepare('DELETE FROM investigations WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Complete investigation
app.post('/api/investigations/:id/complete', (req, res) => {
  db.prepare('UPDATE investigations SET completed_at = ? WHERE id = ?').run(now(), req.params.id);
  res.json(db.prepare('SELECT * FROM investigations WHERE id = ?').get(req.params.id));
});

// Reopen investigation
app.post('/api/investigations/:id/reopen', (req, res) => {
  db.prepare('UPDATE investigations SET completed_at = NULL WHERE id = ?').run(req.params.id);
  res.json(db.prepare('SELECT * FROM investigations WHERE id = ?').get(req.params.id));
});

// ---------------------------------------------------------------------------
// PINS
// ---------------------------------------------------------------------------

// Add pin to investigation
app.post('/api/investigations/:id/pins', (req, res) => {
  const inv = db.prepare('SELECT id FROM investigations WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Investigation not found' });

  const pinId = req.body.id || generateId('pin');
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as mx FROM pins WHERE investigation_id = ? AND parent_pin_id IS NULL'
  ).get(req.params.id);

  db.prepare(`
    INSERT INTO pins (id, investigation_id, parent_pin_id, type, source, title, note, pinned_at, color, data, filters, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pinId,
    req.params.id,
    req.body.parent_pin_id || null,
    req.body.type || 'note',
    req.body.source || '',
    req.body.title || '',
    req.body.note || '',
    req.body.pinned_at || now(),
    req.body.color || null,
    JSON.stringify(req.body.data || {}),
    JSON.stringify(req.body.filters || {}),
    (maxOrder ? maxOrder.mx : -1) + 1
  );

  // Add images if provided
  if (req.body.images && req.body.images.length) {
    const insertImg = db.prepare(`
      INSERT INTO pin_images (pin_id, data_url, caption, link, added_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    req.body.images.forEach((img, idx) => {
      insertImg.run(pinId, img.dataUrl || img.data_url || '', img.caption || '', img.link || '', img.addedAt || img.added_at || now(), idx);
    });
  }

  const pin = db.prepare('SELECT * FROM pins WHERE id = ?').get(pinId);
  pin.data = JSON.parse(pin.data || '{}');
  pin.filters = JSON.parse(pin.filters || '{}');
  pin.images = db.prepare('SELECT * FROM pin_images WHERE pin_id = ? ORDER BY sort_order').all(pinId);
  pin.children = [];
  res.status(201).json(pin);
});

// Update pin
app.put('/api/pins/:id', (req, res) => {
  const pin = db.prepare('SELECT * FROM pins WHERE id = ?').get(req.params.id);
  if (!pin) return res.status(404).json({ error: 'Not found' });

  const fields = ['title', 'note', 'color', 'sort_order', 'type', 'source'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (req.body.data !== undefined) {
    updates.push('data = ?');
    values.push(JSON.stringify(req.body.data));
  }
  if (updates.length) {
    values.push(req.params.id);
    db.prepare(`UPDATE pins SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  const updated = db.prepare('SELECT * FROM pins WHERE id = ?').get(req.params.id);
  updated.data = JSON.parse(updated.data || '{}');
  updated.filters = JSON.parse(updated.filters || '{}');
  res.json(updated);
});

// Delete pin
app.delete('/api/pins/:id', (req, res) => {
  const result = db.prepare('DELETE FROM pins WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Move pin to another investigation
app.post('/api/pins/:id/move', (req, res) => {
  const { target_investigation_id } = req.body;
  if (!target_investigation_id) return res.status(400).json({ error: 'target_investigation_id required' });

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as mx FROM pins WHERE investigation_id = ? AND parent_pin_id IS NULL'
  ).get(target_investigation_id);

  db.prepare(`
    UPDATE pins SET investigation_id = ?, parent_pin_id = NULL, sort_order = ? WHERE id = ?
  `).run(target_investigation_id, (maxOrder ? maxOrder.mx : -1) + 1, req.params.id);

  // Move children too
  db.prepare('UPDATE pins SET investigation_id = ? WHERE parent_pin_id = ?')
    .run(target_investigation_id, req.params.id);

  res.json({ ok: true });
});

// Copy pin to another investigation
app.post('/api/pins/:id/copy', (req, res) => {
  const { target_investigation_id } = req.body;
  if (!target_investigation_id) return res.status(400).json({ error: 'target_investigation_id required' });

  const source = db.prepare('SELECT * FROM pins WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Pin not found' });

  const newId = generateId('pin');
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as mx FROM pins WHERE investigation_id = ? AND parent_pin_id IS NULL'
  ).get(target_investigation_id);

  db.prepare(`
    INSERT INTO pins (id, investigation_id, parent_pin_id, type, source, title, note, pinned_at, color, data, filters, sort_order)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId, target_investigation_id, source.type, source.source, source.title, source.note,
    source.pinned_at, source.color, source.data, source.filters, (maxOrder ? maxOrder.mx : -1) + 1);

  // Copy images
  const images = db.prepare('SELECT * FROM pin_images WHERE pin_id = ?').all(req.params.id);
  const insertImg = db.prepare(`
    INSERT INTO pin_images (pin_id, data_url, caption, link, added_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const img of images) {
    insertImg.run(newId, img.data_url, img.caption, img.link, img.added_at, img.sort_order);
  }

  res.status(201).json({ ok: true, new_pin_id: newId });
});

// Reorder pins within an investigation
app.put('/api/investigations/:id/reorder', (req, res) => {
  const { pin_ids } = req.body;
  if (!Array.isArray(pin_ids)) return res.status(400).json({ error: 'pin_ids array required' });

  const updateOrder = db.prepare('UPDATE pins SET sort_order = ? WHERE id = ? AND investigation_id = ?');
  const batch = db.transaction(() => {
    pin_ids.forEach((pinId, idx) => {
      updateOrder.run(idx, pinId, req.params.id);
    });
  });
  batch();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// IMAGES
// ---------------------------------------------------------------------------

// Add image(s) to pin
app.post('/api/pins/:id/images', (req, res) => {
  const pin = db.prepare('SELECT id FROM pins WHERE id = ?').get(req.params.id);
  if (!pin) return res.status(404).json({ error: 'Pin not found' });

  const images = Array.isArray(req.body) ? req.body : [req.body];
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as mx FROM pin_images WHERE pin_id = ?'
  ).get(req.params.id);
  let order = (maxOrder ? maxOrder.mx : -1) + 1;

  const insertImg = db.prepare(`
    INSERT INTO pin_images (pin_id, data_url, caption, link, added_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const ids = [];
  for (const img of images) {
    const result = insertImg.run(req.params.id, img.data_url || img.dataUrl || '', img.caption || '', img.link || '', now(), order++);
    ids.push(result.lastInsertRowid);
  }
  res.status(201).json({ ok: true, ids });
});

// Update image
app.put('/api/images/:id', (req, res) => {
  const updates = [];
  const values = [];
  if (req.body.caption !== undefined) { updates.push('caption = ?'); values.push(req.body.caption); }
  if (req.body.link !== undefined) { updates.push('link = ?'); values.push(req.body.link); }
  if (updates.length) {
    values.push(req.params.id);
    db.prepare(`UPDATE pin_images SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  res.json({ ok: true });
});

// Delete image
app.delete('/api/images/:id', (req, res) => {
  db.prepare('DELETE FROM pin_images WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// IMPORT / EXPORT
// ---------------------------------------------------------------------------

// Export all investigations as JSON
app.get('/api/export/json', (req, res) => {
  const investigations = db.prepare('SELECT * FROM investigations ORDER BY created DESC').all();
  for (const inv of investigations) {
    inv.pins = [];
    const pins = db.prepare('SELECT * FROM pins WHERE investigation_id = ? ORDER BY sort_order').all(inv.id);
    for (const pin of pins) {
      pin.data = JSON.parse(pin.data || '{}');
      pin.filters = JSON.parse(pin.filters || '{}');
      pin.images = db.prepare('SELECT * FROM pin_images WHERE pin_id = ? ORDER BY sort_order').all(pin.id);
      pin.children = [];
    }
    // Build hierarchy
    const byId = {};
    for (const p of pins) byId[p.id] = p;
    for (const p of pins) {
      if (p.parent_pin_id && byId[p.parent_pin_id]) {
        byId[p.parent_pin_id].children.push(p);
      } else {
        inv.pins.push(p);
      }
    }
  }
  res.setHeader('Content-Disposition', `attachment; filename="audit-angel-backup-${new Date().toISOString().slice(0,10)}.json"`);
  res.json({ version: 1, exported_at: now(), investigations });
});

// Import from JSON (merge mode — skip existing IDs)
app.post('/api/import/json', (req, res) => {
  const { investigations } = req.body;
  if (!Array.isArray(investigations)) return res.status(400).json({ error: 'investigations array required' });

  let imported = 0;
  let skipped = 0;

  const insertInv = db.prepare(`
    INSERT OR IGNORE INTO investigations (id, name, created, completed_at, summary, hypothesis, next_step)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPin = db.prepare(`
    INSERT OR IGNORE INTO pins (id, investigation_id, parent_pin_id, type, source, title, note, pinned_at, color, data, filters, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertImg = db.prepare(`
    INSERT INTO pin_images (pin_id, data_url, caption, link, added_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function importPins(pins, invId, parentId) {
    pins.forEach((pin, idx) => {
      insertPin.run(
        pin.id, invId, parentId || null,
        pin.type || 'note', pin.source || '', pin.title || '', pin.note || '',
        pin.pinned_at || pin.pinnedAt || now(), pin.color || null,
        typeof pin.data === 'string' ? pin.data : JSON.stringify(pin.data || {}),
        typeof pin.filters === 'string' ? pin.filters : JSON.stringify(pin.filters || {}),
        pin.sort_order !== undefined ? pin.sort_order : idx
      );
      const images = pin.images || [];
      images.forEach((img, imgIdx) => {
        insertImg.run(pin.id, img.data_url || img.dataUrl || '', img.caption || '', img.link || '', img.added_at || img.addedAt || now(), imgIdx);
      });
      if (pin.children && pin.children.length) {
        importPins(pin.children, invId, pin.id);
      }
    });
  }

  const batch = db.transaction(() => {
    for (const inv of investigations) {
      const existing = db.prepare('SELECT id FROM investigations WHERE id = ?').get(inv.id);
      if (existing) { skipped++; continue; }
      insertInv.run(inv.id, inv.name, inv.created, inv.completed_at || inv.completedAt || null,
        inv.summary || '', inv.hypothesis || '', inv.next_step || inv.nextStep || '');
      importPins(inv.pins || [], inv.id, null);
      imported++;
    }
  });
  batch();

  res.json({ ok: true, imported, skipped });
});

// Import from localStorage format (phcc_investigations)
app.post('/api/import/localstorage', (req, res) => {
  const lsData = req.body;
  if (!Array.isArray(lsData)) return res.status(400).json({ error: 'Expected array of investigation objects' });

  // Convert localStorage format to our import format
  const investigations = lsData.map(inv => ({
    id: inv.id,
    name: inv.name,
    created: inv.created,
    completed_at: inv.completedAt || null,
    summary: inv.summary || '',
    hypothesis: inv.hypothesis || '',
    next_step: inv.nextStep || '',
    pins: (inv.pins || []).map((pin, idx) => ({
      id: pin.id,
      type: pin.type || 'note',
      source: pin.source || '',
      title: pin.title || '',
      note: pin.note || '',
      pinned_at: pin.pinnedAt || now(),
      color: pin.color || null,
      data: pin.data || {},
      filters: pin.filters || {},
      sort_order: idx,
      images: (pin.images || (pin.imageDataUrl ? [{ dataUrl: pin.imageDataUrl }] : [])).map((img, imgIdx) => ({
        data_url: img.dataUrl || img.data_url || '',
        caption: img.caption || '',
        link: img.link || '',
        added_at: img.addedAt || img.added_at || now(),
        sort_order: imgIdx
      })),
      children: (pin.children || []).map((child, childIdx) => ({
        id: child.id,
        type: child.type || 'note',
        source: child.source || '',
        title: child.title || '',
        note: child.note || '',
        pinned_at: child.pinnedAt || now(),
        color: child.color || null,
        data: child.data || {},
        filters: child.filters || {},
        sort_order: childIdx,
        images: (child.images || []).map((img, imgIdx) => ({
          data_url: img.dataUrl || img.data_url || '',
          caption: img.caption || '',
          link: img.link || '',
          added_at: img.addedAt || img.added_at || now(),
          sort_order: imgIdx
        })),
        children: []
      }))
    }))
  }));

  // Use the same import logic
  req.body = { investigations };
  // Forward to JSON import
  const importResult = importInvestigations(investigations);
  res.json(importResult);
});

function importInvestigations(investigations) {
  const insertInv = db.prepare(`
    INSERT OR IGNORE INTO investigations (id, name, created, completed_at, summary, hypothesis, next_step)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPin = db.prepare(`
    INSERT OR IGNORE INTO pins (id, investigation_id, parent_pin_id, type, source, title, note, pinned_at, color, data, filters, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertImg = db.prepare(`
    INSERT INTO pin_images (pin_id, data_url, caption, link, added_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let imported = 0, skipped = 0;

  function importPins(pins, invId, parentId) {
    for (const pin of pins) {
      insertPin.run(pin.id, invId, parentId || null, pin.type, pin.source, pin.title, pin.note,
        pin.pinned_at, pin.color || null,
        typeof pin.data === 'string' ? pin.data : JSON.stringify(pin.data || {}),
        typeof pin.filters === 'string' ? pin.filters : JSON.stringify(pin.filters || {}),
        pin.sort_order || 0);
      for (const img of (pin.images || [])) {
        insertImg.run(pin.id, img.data_url || '', img.caption || '', img.link || '', img.added_at || now(), img.sort_order || 0);
      }
      if (pin.children) importPins(pin.children, invId, pin.id);
    }
  }

  const batch = db.transaction(() => {
    for (const inv of investigations) {
      const existing = db.prepare('SELECT id FROM investigations WHERE id = ?').get(inv.id);
      if (existing) { skipped++; continue; }
      insertInv.run(inv.id, inv.name, inv.created, inv.completed_at || null, inv.summary || '', inv.hypothesis || '', inv.next_step || '');
      importPins(inv.pins || [], inv.id, null);
      imported++;
    }
  });
  batch();
  return { ok: true, imported, skipped };
}

// ---------------------------------------------------------------------------
// SPA fallback
// ---------------------------------------------------------------------------
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`The Audit Angel running at http://localhost:${PORT}`);
});
