CREATE TABLE transfer_link_suggestions (
  source_entry_id TEXT NOT NULL REFERENCES transactions(id),
  destination_entry_id TEXT NOT NULL REFERENCES transactions(id),
  kind TEXT NOT NULL,
  confidence REAL NOT NULL,
  amount_confidence REAL NOT NULL,
  time_confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_entry_id, destination_entry_id)
);

CREATE INDEX idx_transfer_link_suggestions_source
  ON transfer_link_suggestions(source_entry_id);

CREATE INDEX idx_transfer_link_suggestions_destination
  ON transfer_link_suggestions(destination_entry_id);
