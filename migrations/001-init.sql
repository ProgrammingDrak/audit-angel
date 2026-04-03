-- The Audit Angel — Initial Schema
-- Investigations, pins, and images

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created TEXT NOT NULL,
  completed_at TEXT,
  summary TEXT DEFAULT '',
  hypothesis TEXT DEFAULT '',
  next_step TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pins (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL,
  parent_pin_id TEXT,
  type TEXT DEFAULT 'note',
  source TEXT DEFAULT '',
  title TEXT DEFAULT '',
  note TEXT DEFAULT '',
  pinned_at TEXT NOT NULL,
  color TEXT,
  data TEXT DEFAULT '{}',
  filters TEXT DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_pin_id) REFERENCES pins(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pin_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin_id TEXT NOT NULL,
  data_url TEXT NOT NULL,
  caption TEXT DEFAULT '',
  link TEXT DEFAULT '',
  added_at TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (pin_id) REFERENCES pins(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pins_investigation ON pins(investigation_id);
CREATE INDEX IF NOT EXISTS idx_pins_parent ON pins(parent_pin_id);
CREATE INDEX IF NOT EXISTS idx_images_pin ON pin_images(pin_id);
