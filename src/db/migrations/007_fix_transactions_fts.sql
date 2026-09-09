DROP TRIGGER IF EXISTS transactions_ai;
DROP TRIGGER IF EXISTS transactions_ad;
DROP TRIGGER IF EXISTS transactions_au;
DROP TABLE IF EXISTS transactions_fts;

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
