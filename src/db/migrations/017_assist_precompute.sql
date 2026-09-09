CREATE TABLE entry_embeddings (
  entry_type TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  feature_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entry_type, entry_id)
);

CREATE TABLE annotation_assist_suggestions (
  entry_type TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  status TEXT NOT NULL,
  proposal_json TEXT,
  examples_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL,
  used_classifier INTEGER NOT NULL DEFAULT 0,
  embedding_model TEXT,
  classifier_model TEXT,
  computed_at TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TEXT,
  PRIMARY KEY (entry_type, entry_id)
);

CREATE INDEX idx_assist_suggestions_review
  ON annotation_assist_suggestions(review_status, status, computed_at DESC);
