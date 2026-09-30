-- M12: more kinds of tamper (decided 2026-09-30). Each breaks the seal except 'killed',
-- where the guard brought Sanctum back and the seal resumed (M8).
CREATE TABLE tamper_events_new (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  ts         INTEGER NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('killed', 'clock', 'guard', 'extension'))
);
INSERT INTO tamper_events_new (id, session_id, ts, kind) SELECT id, session_id, ts, kind FROM tamper_events;
DROP TABLE tamper_events;
ALTER TABLE tamper_events_new RENAME TO tamper_events;
CREATE INDEX idx_tamper_events_ts ON tamper_events(ts);
