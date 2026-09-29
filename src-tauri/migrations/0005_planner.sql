-- 4d: Today + Week, local half (SPEC 4.12). Routines are the spec's daily_goals, extended with
-- weekdays, an optional time, and a duration. One-time items are todos, now linkable to a profile.
-- days_mask: bit 0 = Sunday ... bit 6 = Saturday (JavaScript getDay order). 127 = every day.
-- time: 'HH:MM' local, NULL = anytime that day.

ALTER TABLE daily_goals ADD COLUMN days_mask INTEGER NOT NULL DEFAULT 127 CHECK (days_mask BETWEEN 1 AND 127);
ALTER TABLE daily_goals ADD COLUMN time TEXT;
ALTER TABLE daily_goals ADD COLUMN duration_min INTEGER;
ALTER TABLE daily_goals ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_goals ADD COLUMN gcal_event_id TEXT;

ALTER TABLE todos ADD COLUMN profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE todos ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO settings (key, value) VALUES ('home_layout', '{"collapsed":[],"hidden":[]}');
