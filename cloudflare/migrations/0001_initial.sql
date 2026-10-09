PRAGMA foreign_keys = ON;
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  price_threshold REAL,
  created_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_error TEXT,
  alert_error TEXT,
  last_alert TEXT,
  pending_job TEXT,
  queued_at INTEGER,
  lease_until INTEGER NOT NULL DEFAULT 0,
  processing_token TEXT
);
CREATE TABLE observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price REAL NOT NULL CHECK(price > 0),
  currency TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE INDEX observations_product ON observations(product_id, id);
CREATE INDEX products_due ON products(last_attempt_at);
