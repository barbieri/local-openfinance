CREATE TABLE transfer_groups (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  confidence REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE transfer_group_members (
  group_id TEXT NOT NULL REFERENCES transfer_groups(id),
  entry_type TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  role TEXT,
  PRIMARY KEY (group_id, entry_type, entry_id)
);
CREATE INDEX idx_transfer_members_entry ON transfer_group_members(entry_type, entry_id);
