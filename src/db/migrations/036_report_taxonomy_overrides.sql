CREATE TABLE intelligence_taxonomy_overrides (
  report_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('category', 'label')),
  taxonomy_id TEXT NOT NULL,
  treatment TEXT CHECK (
    treatment IS NULL OR treatment IN (
      'internal-own-account',
      'portfolio-movement',
      'account-settlement',
      'reportable',
      'uncertain'
    )
  ),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (report_id, kind, taxonomy_id)
);

INSERT INTO intelligence_taxonomy_overrides (
  report_id,
  kind,
  taxonomy_id,
  treatment,
  updated_at
)
SELECT
  policy.report_id,
  json_extract(decision.value, '$.kind'),
  json_extract(decision.value, '$.id'),
  json_extract(decision.value, '$.treatment'),
  policy.updated_at
FROM intelligence_taxonomy_policies AS policy,
     json_each(
       CASE
         WHEN json_valid(policy.policy_json) THEN policy.policy_json
         ELSE '{"decisions":[]}'
       END,
       '$.decisions'
     ) AS decision
WHERE json_extract(decision.value, '$.source') = 'user'
  AND json_extract(decision.value, '$.kind') IN ('category', 'label')
  AND typeof(json_extract(decision.value, '$.id')) = 'text'
  AND json_extract(decision.value, '$.treatment') IN (
    'internal-own-account',
    'portfolio-movement',
    'account-settlement',
    'reportable',
    'uncertain'
  );
