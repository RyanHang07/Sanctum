-- 4c: Google Calendar (SPEC 4.3). Sanctum pushes routines and timed items to its own calendar
-- and caches events from the calendars you choose. Edits made offline wait in gcal_outbox.

CREATE TABLE gcal_calendars (
  id         TEXT PRIMARY KEY,
  summary    TEXT    NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_sanctum INTEGER NOT NULL DEFAULT 0,
  writable   INTEGER NOT NULL DEFAULT 0,
  selected   INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0
);

-- One row per event occurrence (recurring events expanded). Dates and times are local.
CREATE TABLE gcal_events (
  calendar_id  TEXT    NOT NULL,
  event_id     TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  date         TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  start_time   TEXT,
  duration_min INTEGER,
  start_ms     INTEGER NOT NULL,
  end_ms       INTEGER NOT NULL,
  all_day      INTEGER NOT NULL DEFAULT 0,
  attendees    INTEGER NOT NULL DEFAULT 0,
  recurring    INTEGER NOT NULL DEFAULT 0,
  html_link    TEXT,
  PRIMARY KEY (calendar_id, event_id)
);
CREATE INDEX idx_gcal_events_date ON gcal_events(date);

CREATE TABLE gcal_outbox (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('routine', 'todo', 'check', 'delete')),
  ref_id     INTEGER,
  date       TEXT,
  event_id   TEXT,
  created_at INTEGER NOT NULL
);

ALTER TABLE daily_goals ADD COLUMN gcal_etag TEXT;
-- First day of the recurring series in Google.
ALTER TABLE daily_goals ADD COLUMN gcal_start_date TEXT;
