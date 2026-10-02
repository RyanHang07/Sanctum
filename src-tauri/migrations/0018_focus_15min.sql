-- foreign_keys: off
-- v0.1.1: focus lengths go down to 15 minutes, but 0001 had CHECK (... >= 30) on sessions'
-- planned_minutes and profiles' default_minutes.
-- SQLite can't change a CHECK in place, so the table is rebuilt (the documented 12-step way:
-- foreign keys off for this migration only, so dropping the old table cascades nothing, then a
-- foreign key check before it commits). Every column and row is kept.

CREATE TABLE sessions_new (
  id               INTEGER PRIMARY KEY,
  profile_id       INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  planned_minutes  INTEGER NOT NULL CHECK (planned_minutes >= 15),
  outcome          TEXT CHECK (outcome IN ('completed', 'unlocked_early', 'broken')),
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'calendar')),
  profile_name     TEXT NOT NULL DEFAULT '',
  last_seen_at     INTEGER,
  gap_ms           INTEGER NOT NULL DEFAULT 0,
  broken_at        INTEGER,
  attempts_blocked INTEGER NOT NULL DEFAULT 0,
  idle_ms          INTEGER NOT NULL DEFAULT 0,
  task_kind        TEXT CHECK (task_kind IN ('todo', 'routine')),
  task_id          INTEGER,
  task_date        TEXT,
  task_title       TEXT
);
INSERT INTO sessions_new (id, profile_id, started_at, ended_at, planned_minutes, outcome, source, profile_name, last_seen_at, gap_ms, broken_at, attempts_blocked, idle_ms, task_kind, task_id, task_date, task_title)
  SELECT id, profile_id, started_at, ended_at, planned_minutes, outcome, source, profile_name, last_seen_at, gap_ms, broken_at, attempts_blocked, idle_ms, task_kind, task_id, task_date, task_title FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX idx_sessions_started ON sessions(started_at);

CREATE TABLE profiles_new (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL UNIQUE,
  allowlist_mode  INTEGER NOT NULL DEFAULT 0 CHECK (allowlist_mode IN (0, 1)),
  default_minutes INTEGER NOT NULL DEFAULT 60 CHECK (default_minutes >= 15),
  created_at      INTEGER NOT NULL,
  work_types      TEXT    NOT NULL DEFAULT '[]'
);
INSERT INTO profiles_new (id, name, allowlist_mode, default_minutes, created_at, work_types)
  SELECT id, name, allowlist_mode, default_minutes, created_at, work_types FROM profiles;
DROP TABLE profiles;
ALTER TABLE profiles_new RENAME TO profiles;
