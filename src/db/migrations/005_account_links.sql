CREATE TABLE account_groups (
  canonical_account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE account_group_members (
  group_id TEXT NOT NULL REFERENCES account_groups(canonical_account_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  is_canonical INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, account_id),
  UNIQUE(account_id)
);
CREATE INDEX idx_account_group_members_group ON account_group_members(group_id);
CREATE INDEX idx_account_group_members_account ON account_group_members(account_id);
