-- v0.3.1 (decided 2026-10-30): research-backed additions to the seal.
-- A seal's intent: what will be done (a specific goal) and the if-then plan for temptation.
ALTER TABLE sessions ADD COLUMN goal TEXT;
ALTER TABLE sessions ADD COLUMN plan TEXT;
-- How it went, from the held page: done / partly / no, a 1-5 focus rating, and where you left off.
ALTER TABLE sessions ADD COLUMN result TEXT CHECK (result IN ('done', 'partly', 'no'));
ALTER TABLE sessions ADD COLUMN focus_rating INTEGER CHECK (focus_rating BETWEEN 1 AND 5);
ALTER TABLE sessions ADD COLUMN left_off TEXT;
-- Each profile remembers its last if-then plan.
ALTER TABLE profiles ADD COLUMN plan TEXT;
-- A thought parked mid-seal is a task for today, tagged with the seal it came from.
ALTER TABLE todos ADD COLUMN parked_session INTEGER REFERENCES sessions(id) ON DELETE SET NULL;
-- Pause mode: each "Still want it?" and what you chose.
CREATE TABLE pause_events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  what TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('app', 'site')),
  outcome TEXT NOT NULL CHECK (outcome IN ('went_on', 'turned_back'))
);
CREATE INDEX pause_events_ts ON pause_events (ts);
