-- Free-form notes (decided 2026-09-30): titled plain text, pinned to the top or not. Local only.
CREATE TABLE notes (
  id         INTEGER PRIMARY KEY,
  title      TEXT    NOT NULL DEFAULT '',
  body       TEXT    NOT NULL DEFAULT '',
  pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_notes_updated ON notes(pinned DESC, updated_at DESC);
