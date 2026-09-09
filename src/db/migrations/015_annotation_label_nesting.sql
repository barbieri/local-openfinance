ALTER TABLE annotation_labels ADD COLUMN parent_id TEXT REFERENCES annotation_labels(id);

CREATE INDEX idx_annotation_labels_parent ON annotation_labels(parent_id);
