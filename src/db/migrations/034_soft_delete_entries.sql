ALTER TABLE transactions ADD COLUMN deleted_at TEXT;
ALTER TABLE transactions ADD COLUMN delete_reason TEXT;

ALTER TABLE investments ADD COLUMN deleted_at TEXT;
ALTER TABLE investments ADD COLUMN delete_reason TEXT;

CREATE INDEX idx_transactions_deleted_at ON transactions(deleted_at);
CREATE INDEX idx_investments_deleted_at ON investments(deleted_at);
