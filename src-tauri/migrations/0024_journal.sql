-- v0.2: the journal. One page per local day ('YYYY-MM-DD'), written with the notes editor:
-- the block document (JSON) and its plain text. Kept on this PC only.
CREATE TABLE journal_days (
  date       TEXT    PRIMARY KEY,
  doc        TEXT,
  body       TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
