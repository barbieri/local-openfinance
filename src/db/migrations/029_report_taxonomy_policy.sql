CREATE TABLE intelligence_taxonomy_policies (
  report_id TEXT PRIMARY KEY,
  taxonomy_hash TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
