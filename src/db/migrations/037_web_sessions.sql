CREATE TABLE web_sessions (
  session_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX web_sessions_expires_at_idx ON web_sessions (expires_at);
