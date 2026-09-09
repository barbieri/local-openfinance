CREATE TABLE intelligence_run_model_calls (
  run_id TEXT NOT NULL REFERENCES intelligence_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('taxonomy-policy', 'analyst', 'reviewer')),
  review_round INTEGER,
  step_number INTEGER,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  total_tokens INTEGER,
  reasoning_effort TEXT,
  max_output_tokens INTEGER,
  duration_ms INTEGER,
  finish_reason TEXT,
  tool_names_json TEXT NOT NULL DEFAULT '[]',
  raw_usage_json TEXT,
  provider_metadata_json TEXT,
  pricing_snapshot_json TEXT,
  estimated_cost_microusd INTEGER,
  PRIMARY KEY (run_id, ordinal)
);
CREATE INDEX idx_intelligence_run_model_calls_model
  ON intelligence_run_model_calls(provider, model, phase);

ALTER TABLE intelligence_runs ADD COLUMN model_provider TEXT;
ALTER TABLE intelligence_runs ADD COLUMN model_name TEXT;
ALTER TABLE intelligence_runs ADD COLUMN model_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN model_step_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN model_duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN unpriced_model_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intelligence_runs ADD COLUMN estimated_cost_microusd INTEGER;

ALTER TABLE annotation_embeddings ADD COLUMN input_tokens INTEGER;
ALTER TABLE annotation_embeddings ADD COLUMN pricing_snapshot_json TEXT;
ALTER TABLE annotation_embeddings ADD COLUMN estimated_cost_microusd INTEGER;
ALTER TABLE entry_embeddings ADD COLUMN input_tokens INTEGER;
ALTER TABLE entry_embeddings ADD COLUMN pricing_snapshot_json TEXT;
ALTER TABLE entry_embeddings ADD COLUMN estimated_cost_microusd INTEGER;
