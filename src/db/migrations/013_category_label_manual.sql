ALTER TABLE category_labels ADD COLUMN name_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE category_labels ADD COLUMN icon_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE category_labels ADD COLUMN color_manual INTEGER NOT NULL DEFAULT 0;

UPDATE category_labels SET name_manual = 1 WHERE name IS NOT NULL;
UPDATE category_labels SET icon_manual = 1 WHERE icon IS NOT NULL;
UPDATE category_labels SET color_manual = 1 WHERE color IS NOT NULL;
