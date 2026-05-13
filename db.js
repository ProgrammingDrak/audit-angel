/**
 * db.js — Postgres Database Layer for The Audit Angel
 *
 * Manages connection pool, schema initialization, and query helpers.
 * Uses node-postgres (pg) with parameterized queries throughout.
 */

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// ── Schema Initialization ──

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        display_name  TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS investigations (
        id            TEXT PRIMARY KEY,
        owner_id      INTEGER NOT NULL REFERENCES users(id),
        name          TEXT NOT NULL,
        summary       TEXT NOT NULL DEFAULT '',
        hypothesis    TEXT NOT NULL DEFAULT '',
        next_step     TEXT NOT NULL DEFAULT '',
        completed_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_inv_owner ON investigations(owner_id);
      CREATE INDEX IF NOT EXISTS idx_inv_active ON investigations(completed_at) WHERE completed_at IS NULL;

      CREATE TABLE IF NOT EXISTS investigation_members (
        investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
        user_id          INTEGER NOT NULL REFERENCES users(id),
        role             TEXT NOT NULL DEFAULT 'editor',
        joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (investigation_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_inv_members_user ON investigation_members(user_id);

      CREATE TABLE IF NOT EXISTS pins (
        id                TEXT PRIMARY KEY,
        investigation_id  TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
        parent_pin_id     TEXT REFERENCES pins(id) ON DELETE CASCADE,
        created_by        INTEGER NOT NULL REFERENCES users(id),
        type              TEXT NOT NULL DEFAULT 'item',
        source            TEXT NOT NULL DEFAULT '',
        title             TEXT NOT NULL,
        note              TEXT NOT NULL DEFAULT '',
        color             TEXT,
        data              JSONB NOT NULL DEFAULT '{}',
        filters           JSONB NOT NULL DEFAULT '{}',
        sort_order        REAL NOT NULL DEFAULT 0,
        in_summary        BOOLEAN NOT NULL DEFAULT FALSE,
        pinned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_pins_inv ON pins(investigation_id) WHERE parent_pin_id IS NULL;
      CREATE INDEX IF NOT EXISTS idx_pins_parent ON pins(parent_pin_id) WHERE parent_pin_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_pins_sort ON pins(investigation_id, sort_order);

      CREATE TABLE IF NOT EXISTS pin_images (
        id          SERIAL PRIMARY KEY,
        pin_id      TEXT NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
        data_url    TEXT NOT NULL,
        caption     TEXT NOT NULL DEFAULT '',
        link        TEXT NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_pin_images_pin ON pin_images(pin_id);

      CREATE TABLE IF NOT EXISTS markup_artifacts (
        id                 TEXT PRIMARY KEY,
        investigation_id   TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
        pin_id             TEXT NOT NULL UNIQUE REFERENCES pins(id) ON DELETE CASCADE,
        created_by         INTEGER NOT NULL REFERENCES users(id),
        source_type        TEXT NOT NULL,
        source_name        TEXT NOT NULL DEFAULT '',
        source_mime        TEXT NOT NULL DEFAULT '',
        source_content     TEXT NOT NULL,
        annotations        JSONB NOT NULL DEFAULT '[]',
        page_meta          JSONB NOT NULL DEFAULT '{}',
        thumbnail_data_url TEXT NOT NULL DEFAULT '',
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_markup_artifacts_inv ON markup_artifacts(investigation_id);
      CREATE INDEX IF NOT EXISTS idx_markup_artifacts_pin ON markup_artifacts(pin_id);

      CREATE TABLE IF NOT EXISTS dismissed_anomalies (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        anomaly_key  TEXT NOT NULL,
        note         TEXT NOT NULL DEFAULT '',
        dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, anomaly_key)
      );

      CREATE TABLE IF NOT EXISTS bonus_configs (
        user_id     INTEGER PRIMARY KEY REFERENCES users(id),
        config      JSONB NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id      INTEGER NOT NULL REFERENCES users(id),
        pref_key     TEXT NOT NULL,
        pref_value   JSONB NOT NULL,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, pref_key)
      );

      CREATE TABLE IF NOT EXISTS session (
        sid    VARCHAR NOT NULL COLLATE "default",
        sess   JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL,
        PRIMARY KEY (sid)
      );

      CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
    `);
    console.log("[db] Schema initialized");

    // Migrations for existing databases
    await client.query(`
      ALTER TABLE pins ADD COLUMN IF NOT EXISTS in_summary BOOLEAN NOT NULL DEFAULT FALSE;
    `).catch(() => {}); // safe to ignore if column already exists
    console.log("[db] Migrations applied");
  } finally {
    client.release();
  }
}

// ── Query Helpers ──

async function query(text, params) {
  return pool.query(text, params);
}

async function queryOne(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

async function queryAll(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── User Queries ──

async function findUserByEmail(email) {
  return queryOne("SELECT * FROM users WHERE email = $1", [email]);
}

async function findUserById(id) {
  return queryOne("SELECT id, email, display_name, created_at FROM users WHERE id = $1", [id]);
}

async function createUser(email, displayName, passwordHash) {
  return queryOne(
    "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name",
    [email, displayName, passwordHash]
  );
}

// ── Investigation Queries ──

async function getInvestigationsForUser(userId) {
  return queryAll(`
    SELECT i.*, i.created_at AS created, u.display_name AS owner_name,
      (SELECT COUNT(*) FROM pins p WHERE p.investigation_id = i.id AND p.parent_pin_id IS NULL) AS pin_count
    FROM investigations i
    JOIN users u ON u.id = i.owner_id
    WHERE i.owner_id = $1
       OR i.id IN (SELECT investigation_id FROM investigation_members WHERE user_id = $1)
    ORDER BY i.completed_at IS NOT NULL, i.created_at DESC
  `, [userId]);
}

async function getInvestigation(id) {
  return queryOne(`
    SELECT i.*, i.created_at AS created, u.display_name AS owner_name,
      (SELECT COUNT(*) FROM pins p WHERE p.investigation_id = i.id AND p.parent_pin_id IS NULL) AS pin_count
    FROM investigations i
    JOIN users u ON u.id = i.owner_id
    WHERE i.id = $1
  `, [id]);
}

async function createInvestigation(id, ownerId, name) {
  return queryOne(
    "INSERT INTO investigations (id, owner_id, name) VALUES ($1, $2, $3) RETURNING *",
    [id, ownerId, name]
  );
}

async function updateInvestigation(id, fields) {
  const allowed = ["name", "summary", "hypothesis", "next_step", "completed_at"];
  const sets = [];
  const vals = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx}`);
      vals.push(fields[key]);
      idx++;
    }
  }
  if (sets.length === 0) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  return queryOne(
    `UPDATE investigations SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    vals
  );
}

async function deleteInvestigation(id) {
  return query("DELETE FROM investigations WHERE id = $1", [id]);
}

// ── Access Control ──

async function canAccessInvestigation(invId, userId) {
  const row = await queryOne(`
    SELECT 1 FROM investigations WHERE id = $1 AND owner_id = $2
    UNION
    SELECT 1 FROM investigation_members WHERE investigation_id = $1 AND user_id = $2
  `, [invId, userId]);
  return !!row;
}

async function isInvestigationOwner(invId, userId) {
  const row = await queryOne(
    "SELECT 1 FROM investigations WHERE id = $1 AND owner_id = $2",
    [invId, userId]
  );
  return !!row;
}

// ── Investigation Members ──

async function getMembers(invId) {
  return queryAll(`
    SELECT u.id, u.email, u.display_name, im.role, im.joined_at
    FROM investigation_members im
    JOIN users u ON u.id = im.user_id
    WHERE im.investigation_id = $1
  `, [invId]);
}

async function addMember(invId, userId, role) {
  return queryOne(
    "INSERT INTO investigation_members (investigation_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *",
    [invId, userId, role || "editor"]
  );
}

async function removeMember(invId, userId) {
  return query(
    "DELETE FROM investigation_members WHERE investigation_id = $1 AND user_id = $2",
    [invId, userId]
  );
}

// ── Pin Queries ──

async function getPinsForInvestigation(invId) {
  return queryAll(`
    SELECT p.*, u.display_name AS created_by_name
    FROM pins p
    JOIN users u ON u.id = p.created_by
    WHERE p.investigation_id = $1
    ORDER BY p.parent_pin_id NULLS FIRST, p.sort_order
  `, [invId]);
}

async function createPin(pin) {
  return queryOne(`
    INSERT INTO pins (id, investigation_id, parent_pin_id, created_by, type, source, title, note, color, data, filters, sort_order)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [
    pin.id, pin.investigation_id, pin.parent_pin_id || null, pin.created_by,
    pin.type || "item", pin.source || "", pin.title, pin.note || "",
    pin.color || null, JSON.stringify(pin.data || {}), JSON.stringify(pin.filters || {}),
    pin.sort_order || 0
  ]);
}

async function updatePin(pinId, fields) {
  const allowed = ["title", "note", "color", "in_summary"];
  const sets = [];
  const vals = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx}`);
      vals.push(fields[key]);
      idx++;
    }
  }
  if (sets.length === 0) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(pinId);
  return queryOne(
    `UPDATE pins SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    vals
  );
}

async function deletePin(pinId) {
  return query("DELETE FROM pins WHERE id = $1", [pinId]);
}

async function getPinInvestigationId(pinId) {
  const row = await queryOne("SELECT investigation_id FROM pins WHERE id = $1", [pinId]);
  return row ? row.investigation_id : null;
}

async function reorderPins(invId, items) {
  return transaction(async (client) => {
    for (const item of items) {
      await client.query(
        "UPDATE pins SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND investigation_id = $3",
        [item.sort_order, item.id, invId]
      );
    }
  });
}

async function movePin(pinId, toInvId) {
  const moved = await queryOne(
    "UPDATE pins SET investigation_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [toInvId, pinId]
  );
  await query(
    "UPDATE markup_artifacts SET investigation_id = $1, updated_at = NOW() WHERE pin_id = $2",
    [toInvId, pinId]
  );
  return moved;
}

async function copyPin(pinId, toInvId, newPinId, userId) {
  const original = await queryOne("SELECT * FROM pins WHERE id = $1", [pinId]);
  if (!original) return null;
  const copied = await createPin({
    id: newPinId,
    investigation_id: toInvId,
    parent_pin_id: null,
    created_by: userId,
    type: original.type,
    source: original.source,
    title: original.title,
    note: original.note,
    color: original.color,
    data: original.data,
    filters: original.filters,
    sort_order: original.sort_order,
  });
  // Copy images
  const images = await queryAll("SELECT * FROM pin_images WHERE pin_id = $1 ORDER BY sort_order", [pinId]);
  for (const img of images) {
    await query(
      "INSERT INTO pin_images (pin_id, data_url, caption, link, sort_order) VALUES ($1, $2, $3, $4, $5)",
      [newPinId, img.data_url, img.caption, img.link, img.sort_order]
    );
  }
  if (original.type === "markup") {
    const artifact = await getMarkupArtifactByPin(pinId);
    if (artifact) {
      const newArtifactId = "markup_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      await createMarkupArtifact({
        id: newArtifactId,
        investigation_id: toInvId,
        pin_id: newPinId,
        created_by: userId,
        source_type: artifact.source_type,
        source_name: artifact.source_name,
        source_mime: artifact.source_mime,
        source_content: artifact.source_content,
        annotations: artifact.annotations,
        page_meta: artifact.page_meta,
        thumbnail_data_url: artifact.thumbnail_data_url,
      });
      await updatePinData(newPinId, {
        ...(copied.data || {}),
        artifactId: newArtifactId,
      });
      copied.data = { ...(copied.data || {}), artifactId: newArtifactId };
    }
  }
  return copied;
}

async function updatePinData(pinId, data) {
  return queryOne(
    "UPDATE pins SET data = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [JSON.stringify(data || {}), pinId]
  );
}

// ── Markup Artifacts ──

async function createMarkupArtifact(artifact) {
  return queryOne(`
    INSERT INTO markup_artifacts (
      id, investigation_id, pin_id, created_by, source_type, source_name, source_mime,
      source_content, annotations, page_meta, thumbnail_data_url
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [
    artifact.id,
    artifact.investigation_id,
    artifact.pin_id,
    artifact.created_by,
    artifact.source_type,
    artifact.source_name || "",
    artifact.source_mime || "",
    artifact.source_content,
    JSON.stringify(artifact.annotations || []),
    JSON.stringify(artifact.page_meta || {}),
    artifact.thumbnail_data_url || "",
  ]);
}

async function getMarkupArtifact(id) {
  return queryOne("SELECT * FROM markup_artifacts WHERE id = $1", [id]);
}

async function getMarkupArtifactByPin(pinId) {
  return queryOne("SELECT * FROM markup_artifacts WHERE pin_id = $1", [pinId]);
}

async function updateMarkupArtifact(id, fields) {
  const allowed = ["annotations", "page_meta", "thumbnail_data_url"];
  const sets = [];
  const vals = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx}`);
      vals.push(key === "thumbnail_data_url" ? (fields[key] || "") : JSON.stringify(fields[key] || (key === "annotations" ? [] : {})));
      idx++;
    }
  }
  if (sets.length === 0) return null;
  sets.push("updated_at = NOW()");
  vals.push(id);
  return queryOne(`UPDATE markup_artifacts SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals);
}

// ── Pin Images ──

async function getImagesForPin(pinId) {
  return queryAll("SELECT * FROM pin_images WHERE pin_id = $1 ORDER BY sort_order", [pinId]);
}

async function addImage(pinId, dataUrl, caption, link) {
  const maxOrder = await queryOne("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM pin_images WHERE pin_id = $1", [pinId]);
  return queryOne(
    "INSERT INTO pin_images (pin_id, data_url, caption, link, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [pinId, dataUrl, caption || "", link || "", maxOrder.next]
  );
}

async function deleteImage(imageId) {
  return query("DELETE FROM pin_images WHERE id = $1", [imageId]);
}

// ── Dismissed Anomalies ──

async function getDismissedAnomalies(userId) {
  return queryAll("SELECT * FROM dismissed_anomalies WHERE user_id = $1", [userId]);
}

async function dismissAnomaly(userId, anomalyKey, note) {
  return queryOne(`
    INSERT INTO dismissed_anomalies (user_id, anomaly_key, note)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, anomaly_key) DO UPDATE SET note = $3, dismissed_at = NOW()
    RETURNING *
  `, [userId, anomalyKey, note || ""]);
}

async function restoreAnomaly(userId, anomalyKey) {
  return query("DELETE FROM dismissed_anomalies WHERE user_id = $1 AND anomaly_key = $2", [userId, anomalyKey]);
}

// ── Bonus Config ──

async function getBonusConfig(userId) {
  const row = await queryOne("SELECT config FROM bonus_configs WHERE user_id = $1", [userId]);
  return row ? row.config : null;
}

async function saveBonusConfig(userId, config) {
  return queryOne(`
    INSERT INTO bonus_configs (user_id, config) VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET config = $2, updated_at = NOW()
    RETURNING *
  `, [userId, JSON.stringify(config)]);
}

// ── User Preferences ──

async function getPreferences(userId) {
  const rows = await queryAll("SELECT pref_key, pref_value FROM user_preferences WHERE user_id = $1", [userId]);
  const prefs = {};
  for (const r of rows) prefs[r.pref_key] = r.pref_value;
  return prefs;
}

async function setPreference(userId, key, value) {
  return queryOne(`
    INSERT INTO user_preferences (user_id, pref_key, pref_value) VALUES ($1, $2, $3)
    ON CONFLICT (user_id, pref_key) DO UPDATE SET pref_value = $3, updated_at = NOW()
    RETURNING *
  `, [userId, key, JSON.stringify(value)]);
}

module.exports = {
  pool, initDB, query, queryOne, queryAll, transaction,
  findUserByEmail, findUserById, createUser,
  getInvestigationsForUser, getInvestigation, createInvestigation, updateInvestigation, deleteInvestigation,
  canAccessInvestigation, isInvestigationOwner,
  getMembers, addMember, removeMember,
  getPinsForInvestigation, createPin, updatePin, updatePinData, deletePin, getPinInvestigationId, reorderPins, movePin, copyPin,
  createMarkupArtifact, getMarkupArtifact, getMarkupArtifactByPin, updateMarkupArtifact,
  getImagesForPin, addImage, deleteImage,
  getDismissedAnomalies, dismissAnomaly, restoreAnomaly,
  getBonusConfig, saveBonusConfig,
  getPreferences, setPreference,
};
