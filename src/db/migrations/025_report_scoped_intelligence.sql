ALTER TABLE intelligence_memory RENAME TO intelligence_memory_legacy;
CREATE TABLE intelligence_memory (
  id TEXT PRIMARY KEY,
  markdown TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL CHECK (updated_by IN ('user', 'report-agent', 'chat-agent'))
);
INSERT INTO intelligence_memory (id, markdown, updated_at, updated_by)
SELECT id, markdown, updated_at,
  CASE WHEN updated_by = 'weekly-agent' THEN 'report-agent' ELSE updated_by END
FROM intelligence_memory_legacy;
DROP TABLE intelligence_memory_legacy;

ALTER TABLE intelligence_run_charts RENAME TO intelligence_run_charts_legacy;
ALTER TABLE intelligence_runs RENAME TO intelligence_runs_legacy;
CREATE TABLE intelligence_runs (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL,
  subject TEXT NOT NULL,
  alert_count INTEGER NOT NULL,
  briefing_json TEXT NOT NULL,
  markdown TEXT NOT NULL,
  html TEXT NOT NULL,
  memory_before TEXT,
  memory_after TEXT,
  cited_transaction_ids_json TEXT NOT NULL
);
INSERT INTO intelligence_runs (
  id, report_id, period_start, period_end, created_at, subject, alert_count,
  briefing_json, markdown, html, memory_before, memory_after, cited_transaction_ids_json
)
SELECT id, 'default', period_start, period_end, created_at, subject, alert_count,
  briefing_json, markdown, html, memory_before, memory_after, cited_transaction_ids_json
FROM intelligence_runs_legacy;
CREATE INDEX idx_intelligence_runs_report_created
  ON intelligence_runs(report_id, created_at DESC);
CREATE TABLE intelligence_run_charts (
  run_id TEXT NOT NULL REFERENCES intelligence_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (run_id, name)
);
INSERT INTO intelligence_run_charts (run_id, name, mime_type, bytes)
SELECT run_id, name, mime_type, bytes FROM intelligence_run_charts_legacy;
DROP TABLE intelligence_run_charts_legacy;
DROP TABLE intelligence_runs_legacy;
