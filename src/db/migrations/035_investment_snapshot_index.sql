ALTER TABLE intelligence_runs ADD COLUMN investment_snapshot_version INTEGER;
ALTER TABLE intelligence_runs ADD COLUMN investment_scope_fingerprint TEXT;

UPDATE intelligence_runs
SET
  investment_snapshot_version = CASE
    WHEN json_valid(briefing_json)
      AND json_type(briefing_json, '$.investments.version') = 'integer'
      AND json_type(briefing_json, '$.investments.scopeFingerprint') = 'text'
    THEN json_extract(briefing_json, '$.investments.version')
  END,
  investment_scope_fingerprint = CASE
    WHEN json_valid(briefing_json)
      AND json_type(briefing_json, '$.investments.version') = 'integer'
      AND json_type(briefing_json, '$.investments.scopeFingerprint') = 'text'
    THEN json_extract(briefing_json, '$.investments.scopeFingerprint')
  END;

CREATE INDEX idx_intelligence_runs_investment_snapshot
  ON intelligence_runs(
    report_id,
    investment_snapshot_version,
    investment_scope_fingerprint,
    period_end DESC,
    created_at DESC,
    id DESC
  );
