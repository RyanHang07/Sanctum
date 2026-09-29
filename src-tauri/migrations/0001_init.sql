-- Milestone 1: local schema from SPEC 5.1.
-- Timestamps are unix milliseconds (INTEGER). Dates are 'YYYY-MM-DD', times are 'HH:MM' (local).

CREATE TABLE profiles (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL UNIQUE,
  allowlist_mode  INTEGER NOT NULL DEFAULT 0 CHECK (allowlist_mode IN (0, 1)),
  default_minutes INTEGER NOT NULL DEFAULT 60 CHECK (default_minutes >= 30),
  created_at      INTEGER NOT NULL
);

CREATE TABLE profile_rules (
  id         INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('app', 'domain', 'title', 'launch_app', 'launch_url')),
  value      TEXT    NOT NULL
);
CREATE INDEX idx_profile_rules_profile ON profile_rules(profile_id);

CREATE TABLE sessions (
  id              INTEGER PRIMARY KEY,
  profile_id      INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  planned_minutes INTEGER NOT NULL CHECK (planned_minutes >= 30),
  outcome         TEXT CHECK (outcome IN ('completed', 'unlocked_early', 'broken')),
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'calendar'))
);
CREATE INDEX idx_sessions_started ON sessions(started_at);

CREATE TABLE unlock_attempts (
  id            INTEGER PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  level_reached INTEGER NOT NULL CHECK (level_reached BETWEEN 1 AND 3),
  reason        TEXT,
  approved      INTEGER CHECK (approved IN (0, 1)),
  created_at    INTEGER NOT NULL
);

CREATE TABLE activity (
  id         INTEGER PRIMARY KEY,
  ts         INTEGER NOT NULL,
  exe        TEXT    NOT NULL,
  title      TEXT    NOT NULL DEFAULT '',
  duration_s INTEGER NOT NULL DEFAULT 0,
  category   TEXT    NOT NULL DEFAULT 'neutral' CHECK (category IN ('productive', 'neutral', 'distracting')),
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL
);
CREATE INDEX idx_activity_ts ON activity(ts);

CREATE TABLE idle_periods (
  id         INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE TABLE classification_rules (
  id         INTEGER PRIMARY KEY,
  match_kind TEXT NOT NULL CHECK (match_kind IN ('exe', 'title', 'domain')),
  pattern    TEXT NOT NULL,
  category   TEXT NOT NULL CHECK (category IN ('productive', 'neutral', 'distracting'))
);

CREATE TABLE daily_goals (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE daily_goal_checks (
  goal_id INTEGER NOT NULL REFERENCES daily_goals(id) ON DELETE CASCADE,
  date    TEXT    NOT NULL,
  done_at INTEGER NOT NULL,
  PRIMARY KEY (goal_id, date)
);

CREATE TABLE todos (
  id            INTEGER PRIMARY KEY,
  title         TEXT    NOT NULL,
  due_date      TEXT,
  due_time      TEXT,
  duration_min  INTEGER,
  repeat_rule   TEXT,
  done_at       INTEGER,
  gcal_event_id TEXT,
  gcal_etag     TEXT,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_todos_due ON todos(due_date);

CREATE TABLE trackers (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  unit    TEXT NOT NULL DEFAULT '',
  kind    TEXT NOT NULL CHECK (kind IN ('number', 'bool', 'scale')),
  display TEXT NOT NULL DEFAULT 'both' CHECK (display IN ('chart', 'table', 'both')),
  goal    REAL
);

CREATE TABLE tracker_entries (
  id         INTEGER PRIMARY KEY,
  tracker_id INTEGER NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  value      REAL    NOT NULL,
  logged_at  INTEGER NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('checkin', 'manual'))
);
CREATE INDEX idx_tracker_entries_tracker ON tracker_entries(tracker_id, logged_at);

CREATE TABLE checkins (
  id                  INTEGER PRIMARY KEY,
  name                TEXT    NOT NULL,
  time                TEXT    NOT NULL,
  days_mask           INTEGER NOT NULL DEFAULT 127,
  tracker_ids         TEXT    NOT NULL DEFAULT '[]',
  include_goal_review INTEGER NOT NULL DEFAULT 0 CHECK (include_goal_review IN (0, 1))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('on_login', 'home'),
  ('close_action', 'ask'),
  ('daily_reset_time', '04:00'),
  ('checkin_on_startup', '1');
