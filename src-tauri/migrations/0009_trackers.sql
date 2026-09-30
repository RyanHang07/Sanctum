-- M11: trackers are fully custom (decided 2026-09-29). Adds text trackers (a short note per
-- entry), ordering, and a log of which check-ins were answered or skipped each day.

CREATE TABLE trackers_new (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  unit       TEXT    NOT NULL DEFAULT '',
  kind       TEXT    NOT NULL CHECK (kind IN ('number', 'bool', 'scale', 'text')),
  display    TEXT    NOT NULL DEFAULT 'both' CHECK (display IN ('chart', 'table', 'both')),
  goal       REAL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO trackers_new (id, name, unit, kind, display, goal, sort)
  SELECT id, name, unit, kind, display, goal, id FROM trackers;

CREATE TABLE tracker_entries_new (
  id         INTEGER PRIMARY KEY,
  tracker_id INTEGER NOT NULL REFERENCES trackers_new(id) ON DELETE CASCADE,
  value      REAL,
  text       TEXT,
  logged_at  INTEGER NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('checkin', 'manual')),
  checkin_id INTEGER REFERENCES checkins(id) ON DELETE SET NULL,
  CHECK (value IS NOT NULL OR text IS NOT NULL)
);
INSERT INTO tracker_entries_new (id, tracker_id, value, logged_at, source)
  SELECT id, tracker_id, value, logged_at, source FROM tracker_entries;

DROP TABLE tracker_entries;
DROP TABLE trackers;
ALTER TABLE trackers_new RENAME TO trackers;
ALTER TABLE tracker_entries_new RENAME TO tracker_entries;
CREATE INDEX idx_tracker_entries_tracker ON tracker_entries(tracker_id, logged_at);

ALTER TABLE checkins ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;

-- One row per check-in per local day once it's been answered or skipped.
CREATE TABLE checkin_log (
  checkin_id INTEGER NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  outcome    TEXT    NOT NULL CHECK (outcome IN ('logged', 'skipped')),
  at         INTEGER NOT NULL,
  PRIMARY KEY (checkin_id, date)
);
