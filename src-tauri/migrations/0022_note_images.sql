-- v0.2: images in notes. Stored here (so backups carry them), once per distinct image (sha),
-- and referenced from a note's document as "noteimg:<id>".
CREATE TABLE note_images (
  id         INTEGER PRIMARY KEY,
  sha        TEXT    NOT NULL UNIQUE,
  mime       TEXT    NOT NULL,
  bytes      BLOB    NOT NULL,
  created_at INTEGER NOT NULL
);
