-- M8: the guard service. One row each time it had to bring Sanctum back mid-seal
-- (decided 2026-09-30: logged, but the seal resumes and isn't broken).
CREATE TABLE tamper_events (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  ts         INTEGER NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('killed'))
);
CREATE INDEX idx_tamper_events_ts ON tamper_events(ts);
