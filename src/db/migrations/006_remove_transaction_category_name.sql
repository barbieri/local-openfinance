DROP TRIGGER IF EXISTS transactions_ai;
DROP TRIGGER IF EXISTS transactions_ad;
DROP TRIGGER IF EXISTS transactions_au;
DROP TABLE IF EXISTS transactions_fts;

CREATE TABLE transactions_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  occurred_at TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  description TEXT,
  category_id TEXT,
  merchant_name TEXT,
  payment_type TEXT,
  status TEXT,
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

INSERT INTO transactions_new (
  id, account_id, occurred_at, amount_cents, currency, description,
  category_id, merchant_name, payment_type, status, raw_json, synced_at
)
SELECT
  id, account_id, occurred_at, amount_cents, currency, description,
  category_id, merchant_name, payment_type, status, raw_json, synced_at
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX idx_transactions_account_occurred ON transactions(account_id, occurred_at);
CREATE INDEX idx_transactions_occurred ON transactions(occurred_at);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_amount ON transactions(amount_cents);

CREATE VIRTUAL TABLE transactions_fts USING fts5(
  description,
  merchant_name,
  content='transactions',
  content_rowid='rowid'
);

CREATE TRIGGER transactions_ai AFTER INSERT ON transactions BEGIN
  INSERT INTO transactions_fts(rowid, description, merchant_name)
  VALUES (new.rowid, new.description, new.merchant_name);
END;

CREATE TRIGGER transactions_ad AFTER DELETE ON transactions BEGIN
  INSERT INTO transactions_fts(transactions_fts, rowid, description, merchant_name)
  VALUES ('delete', old.rowid, old.description, old.merchant_name);
END;

CREATE TRIGGER transactions_au AFTER UPDATE ON transactions BEGIN
  INSERT INTO transactions_fts(transactions_fts, rowid, description, merchant_name)
  VALUES ('delete', old.rowid, old.description, old.merchant_name);
  INSERT INTO transactions_fts(rowid, description, merchant_name)
  VALUES (new.rowid, new.description, new.merchant_name);
END;

INSERT INTO transactions_fts(transactions_fts) VALUES ('rebuild');
