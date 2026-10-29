-- v0.1.4: a seal broken by the PC going off mid-seal is logged as tamper, kind 'shutdown'
-- (a reboot happened since the session was last seen); without a reboot it's 'killed'.
-- tamper_events only points at sessions, so a plain rebuild keeps every row.
CREATE TABLE tamper_events_new (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
  ts         INTEGER NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('killed', 'clock', 'guard', 'extension', 'shutdown'))
);
INSERT INTO tamper_events_new (id, session_id, ts, kind) SELECT id, session_id, ts, kind FROM tamper_events;
DROP TABLE tamper_events;
ALTER TABLE tamper_events_new RENAME TO tamper_events;
CREATE INDEX idx_tamper_events_ts ON tamper_events(ts);
