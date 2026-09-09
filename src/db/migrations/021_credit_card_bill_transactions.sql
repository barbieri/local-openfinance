CREATE TABLE credit_card_bill_transactions (
  bill_id TEXT NOT NULL REFERENCES credit_card_bills(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('transaction_metadata', 'inferred', 'manual')),
  confidence INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (bill_id, transaction_id)
);

CREATE INDEX idx_credit_card_bill_transactions_transaction
  ON credit_card_bill_transactions(transaction_id);

CREATE INDEX idx_credit_card_bill_transactions_bill
  ON credit_card_bill_transactions(bill_id);
