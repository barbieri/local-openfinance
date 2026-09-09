CREATE TABLE intelligence_chats (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  seed_run_id TEXT REFERENCES intelligence_runs(id) ON DELETE CASCADE,
  messages_json TEXT NOT NULL,
  generation_started_at TEXT,
  generation_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_intelligence_chats_report_updated
  ON intelligence_chats(report_id, updated_at DESC);
