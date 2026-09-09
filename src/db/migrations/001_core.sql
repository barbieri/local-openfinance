CREATE TABLE sync_cursors (
  resource TEXT PRIMARY KEY,
  cursor_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE connections (
  item_id TEXT PRIMARY KEY,
  connector_id TEXT,
  connector_name TEXT,
  status TEXT,
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_connections_connector_id ON connections(connector_id);
CREATE INDEX idx_connections_connector_name ON connections(connector_name);
CREATE INDEX idx_connections_status ON connections(status);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  connection_item_id TEXT NOT NULL REFERENCES connections(item_id),
  type TEXT NOT NULL,
  subtype TEXT,
  name TEXT,
  number TEXT,
  owner TEXT,
  balance_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'BRL',
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_accounts_connection ON accounts(connection_item_id);
CREATE INDEX idx_accounts_type ON accounts(type);
CREATE INDEX idx_accounts_name ON accounts(name);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  occurred_at TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  description TEXT,
  category_id TEXT,
  category_name TEXT,
  merchant_name TEXT,
  payment_type TEXT,
  status TEXT,
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_transactions_account_occurred ON transactions(account_id, occurred_at);
CREATE INDEX idx_transactions_occurred ON transactions(occurred_at);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_amount ON transactions(amount_cents);

CREATE VIRTUAL TABLE transactions_fts USING fts5(
  description,
  merchant_name,
  category_name,
  content='transactions',
  content_rowid='rowid'
);

CREATE TRIGGER transactions_ai AFTER INSERT ON transactions BEGIN
  INSERT INTO transactions_fts(rowid, description, merchant_name, category_name)
  VALUES (new.rowid, new.description, new.merchant_name, new.category_name);
END;

CREATE TRIGGER transactions_ad AFTER DELETE ON transactions BEGIN
  INSERT INTO transactions_fts(transactions_fts, rowid, description, merchant_name, category_name)
  VALUES ('delete', old.rowid, old.description, old.merchant_name, old.category_name);
END;

CREATE TRIGGER transactions_au AFTER UPDATE ON transactions BEGIN
  INSERT INTO transactions_fts(transactions_fts, rowid, description, merchant_name, category_name)
  VALUES ('delete', old.rowid, old.description, old.merchant_name, old.category_name);
  INSERT INTO transactions_fts(rowid, description, merchant_name, category_name)
  VALUES (new.rowid, new.description, new.merchant_name, new.category_name);
END;

CREATE TABLE investments (
  id TEXT PRIMARY KEY,
  connection_item_id TEXT NOT NULL REFERENCES connections(item_id),
  type TEXT,
  subtype TEXT,
  name TEXT,
  code TEXT,
  balance_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'BRL',
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_investments_connection ON investments(connection_item_id);
CREATE INDEX idx_investments_type ON investments(type);

CREATE TABLE investment_transactions (
  id TEXT PRIMARY KEY,
  investment_id TEXT NOT NULL REFERENCES investments(id),
  occurred_at TEXT NOT NULL,
  type TEXT,
  amount_cents INTEGER,
  quantity REAL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_investment_tx_investment_occurred
  ON investment_transactions(investment_id, occurred_at);

CREATE TABLE credit_card_bills (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  due_date TEXT,
  total_amount_cents INTEGER,
  minimum_payment_cents INTEGER,
  payment_status TEXT,
  currency TEXT NOT NULL DEFAULT 'BRL',
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_bills_account_due ON credit_card_bills(account_id, due_date);
CREATE INDEX idx_bills_payment_status ON credit_card_bills(payment_status);

CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  connection_item_id TEXT NOT NULL REFERENCES connections(item_id),
  type TEXT,
  contract_amount_cents INTEGER,
  due_date TEXT,
  contract_number TEXT,
  currency TEXT NOT NULL DEFAULT 'BRL',
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_loans_connection ON loans(connection_item_id);
CREATE INDEX idx_loans_type ON loans(type);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_translated TEXT,
  parent_id TEXT,
  parent_name TEXT,
  raw_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_name ON categories(name);
