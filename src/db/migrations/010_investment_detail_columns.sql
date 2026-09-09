ALTER TABLE investments ADD COLUMN status TEXT;
ALTER TABLE investments ADD COLUMN isin TEXT;
ALTER TABLE investments ADD COLUMN quantity REAL;
ALTER TABLE investments ADD COLUMN unit_price_cents INTEGER;
ALTER TABLE investments ADD COLUMN total_cents INTEGER;
ALTER TABLE investments ADD COLUMN amount_cents INTEGER;
ALTER TABLE investments ADD COLUMN amount_withdrawal_cents INTEGER;
ALTER TABLE investments ADD COLUMN issuer TEXT;
ALTER TABLE investments ADD COLUMN issuer_cnpj TEXT;
ALTER TABLE investments ADD COLUMN rate REAL;
ALTER TABLE investments ADD COLUMN rate_type TEXT;
ALTER TABLE investments ADD COLUMN purchase_date TEXT;
ALTER TABLE investments ADD COLUMN due_date TEXT;
ALTER TABLE investments ADD COLUMN taxes_cents INTEGER;
ALTER TABLE investments ADD COLUMN taxes2_cents INTEGER;

CREATE INDEX IF NOT EXISTS idx_investments_status ON investments(status);
