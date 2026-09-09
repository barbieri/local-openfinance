CREATE TABLE intelligence_memory (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  markdown TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL CHECK (updated_by IN ('user', 'weekly-agent', 'chat-agent'))
);

CREATE TABLE intelligence_runs (
  id TEXT PRIMARY KEY,
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

CREATE INDEX idx_intelligence_runs_created ON intelligence_runs(created_at DESC);

CREATE TABLE intelligence_run_charts (
  run_id TEXT NOT NULL REFERENCES intelligence_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (run_id, name)
);
