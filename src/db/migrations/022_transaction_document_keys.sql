ALTER TABLE transactions ADD COLUMN payer_document_key TEXT;
ALTER TABLE transactions ADD COLUMN receiver_document_key TEXT;
ALTER TABLE transactions ADD COLUMN merchant_document_key TEXT;

CREATE INDEX idx_transactions_payer_document_key
  ON transactions(payer_document_key);
CREATE INDEX idx_transactions_receiver_document_key
  ON transactions(receiver_document_key);
CREATE INDEX idx_transactions_merchant_document_key
  ON transactions(merchant_document_key);
