CREATE TABLE connection_labels (
  item_id TEXT PRIMARY KEY REFERENCES connections(item_id) ON DELETE CASCADE,
  branch TEXT,
  account TEXT,
  name TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_connection_labels_name ON connection_labels(name);
