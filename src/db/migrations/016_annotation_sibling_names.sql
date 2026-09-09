CREATE UNIQUE INDEX idx_annotation_categories_parent_name
  ON annotation_categories(COALESCE(parent_id, ''), name);

CREATE UNIQUE INDEX idx_annotation_labels_parent_name
  ON annotation_labels(COALESCE(parent_id, ''), name);
