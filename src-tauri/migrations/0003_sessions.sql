-- Milestone 3: session engine + app blocking.
-- A running session has ended_at = NULL. last_seen_at is written every 10s so a restart can tell
-- how long Sanctum was down; gap_ms accumulates that downtime. broken_at is set when a gap
-- exceeds 60s: the seal resumes, but the session can no longer finish as completed.

ALTER TABLE sessions ADD COLUMN profile_name TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
ALTER TABLE sessions ADD COLUMN gap_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN broken_at INTEGER;
ALTER TABLE sessions ADD COLUMN attempts_blocked INTEGER NOT NULL DEFAULT 0;

-- One row per blocked launch (grouped per app per tick), for the intercept count and stats (M5).
CREATE TABLE blocked_attempts (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts         INTEGER NOT NULL,
  exe        TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('app', 'allowlist', 'title'))
);
CREATE INDEX idx_blocked_attempts_session ON blocked_attempts(session_id);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('sounds', '1'),
  ('daily_goal_min', '120'),
  ('allowlist_always_allowed', '1password.exe, bitwarden.exe, keepassxc.exe');
