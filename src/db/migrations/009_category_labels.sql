CREATE TABLE category_labels (
  category_id TEXT PRIMARY KEY REFERENCES categories(id),
  name TEXT,
  icon TEXT,
  color TEXT,
  updated_at TEXT NOT NULL
);
