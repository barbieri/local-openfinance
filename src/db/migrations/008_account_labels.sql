CREATE TABLE account_labels (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_account_labels_name ON account_labels(name);
