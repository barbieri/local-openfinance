CREATE TABLE transaction_category_overrides (
  transaction_id TEXT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_transaction_category_overrides_category
  ON transaction_category_overrides(category_id);
