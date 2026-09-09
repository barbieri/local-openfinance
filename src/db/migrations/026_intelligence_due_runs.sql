ALTER TABLE intelligence_runs ADD COLUMN trigger_kind TEXT
  CHECK (trigger_kind IN ('manual', 'due'));
ALTER TABLE intelligence_runs ADD COLUMN due_key TEXT;

CREATE UNIQUE INDEX idx_intelligence_runs_report_due
  ON intelligence_runs(report_id, due_key)
  WHERE due_key IS NOT NULL;
