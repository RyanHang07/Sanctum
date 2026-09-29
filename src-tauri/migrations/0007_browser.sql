-- 4b: the browser extension (SPEC 4.4, BACKLOG 4b). Sealed sites and keyword tabs blocked in
-- the browser count as attempts, and a missing extension mid-seal is logged too.

CREATE TABLE blocked_attempts_new (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts         INTEGER NOT NULL,
  -- The exe for apps; the site for 'site'; the browser exe for 'extension'.
  exe        TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('app', 'allowlist', 'title', 'site', 'extension'))
);
INSERT INTO blocked_attempts_new (id, session_id, ts, exe, kind) SELECT id, session_id, ts, exe, kind FROM blocked_attempts;
DROP TABLE blocked_attempts;
ALTER TABLE blocked_attempts_new RENAME TO blocked_attempts;
CREATE INDEX idx_blocked_attempts_session ON blocked_attempts(session_id);

-- Per-site exceptions: pages under a sealed site that stay open ("youtube.com/@mitocw").
-- prefix is a bare host plus path, as normalized in profiles.rs.
CREATE TABLE site_exceptions (
  id      INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES profile_rules(id) ON DELETE CASCADE,
  prefix  TEXT    NOT NULL,
  UNIQUE (rule_id, prefix)
);
