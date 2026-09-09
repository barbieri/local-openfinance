CREATE TABLE annotation_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES annotation_categories(id),
  icon TEXT,
  color TEXT,
  sort_order INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_annotation_categories_parent ON annotation_categories(parent_id);

CREATE TABLE annotation_labels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  sort_order INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE entry_annotations (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  category_id TEXT REFERENCES annotation_categories(id),
  sub_category_id TEXT REFERENCES annotation_categories(id),
  notes TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entry_type, entry_id)
);
CREATE INDEX idx_entry_annotations_category ON entry_annotations(category_id);
CREATE INDEX idx_entry_annotations_sub_category ON entry_annotations(sub_category_id);
CREATE INDEX idx_entry_annotations_entry ON entry_annotations(entry_type, entry_id);

CREATE TABLE entry_annotation_labels (
  annotation_id TEXT NOT NULL REFERENCES entry_annotations(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES annotation_labels(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (annotation_id, label_id)
);
CREATE INDEX idx_entry_annotation_labels_label ON entry_annotation_labels(label_id);

CREATE TABLE annotation_embeddings (
  annotation_id TEXT PRIMARY KEY REFERENCES entry_annotations(id),
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE annotation_notes_fts USING fts5(notes, content='entry_annotations', content_rowid='rowid');

CREATE TRIGGER entry_annotations_ai AFTER INSERT ON entry_annotations BEGIN
  INSERT INTO annotation_notes_fts(rowid, notes) VALUES (new.rowid, new.notes);
END;

CREATE TRIGGER entry_annotations_ad AFTER DELETE ON entry_annotations BEGIN
  INSERT INTO annotation_notes_fts(annotation_notes_fts, rowid, notes)
  VALUES ('delete', old.rowid, old.notes);
END;

CREATE TRIGGER entry_annotations_au AFTER UPDATE ON entry_annotations BEGIN
  INSERT INTO annotation_notes_fts(annotation_notes_fts, rowid, notes)
  VALUES ('delete', old.rowid, old.notes);
  INSERT INTO annotation_notes_fts(rowid, notes) VALUES (new.rowid, new.notes);
END;
