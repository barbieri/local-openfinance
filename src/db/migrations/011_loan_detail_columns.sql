ALTER TABLE loans ADD COLUMN name TEXT;
ALTER TABLE loans ADD COLUMN outstanding_balance_cents INTEGER;
ALTER TABLE loans ADD COLUMN installment_cents INTEGER;
ALTER TABLE loans ADD COLUMN paid_installments INTEGER;
ALTER TABLE loans ADD COLUMN total_installments INTEGER;
ALTER TABLE loans ADD COLUMN contracted_date TEXT;
ALTER TABLE loans ADD COLUMN interest_rate REAL;
ALTER TABLE loans ADD COLUMN creditor TEXT;
