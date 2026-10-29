-- v0.1.4: counter routines ("Protein, 150 g a day"). A counter is a routine linked to a number
-- tracker: you add amounts through the day, every entry lands in the tracker (so Trackers keeps
-- the history), and the routine counts as done once the day's total reaches the goal.
-- note_mode: whether each entry asks for a note ('required', 'optional', 'off').
ALTER TABLE daily_goals ADD COLUMN tracker_id INTEGER REFERENCES trackers(id) ON DELETE SET NULL;
ALTER TABLE daily_goals ADD COLUMN goal_amount REAL;
ALTER TABLE daily_goals ADD COLUMN note_mode TEXT NOT NULL DEFAULT 'optional' CHECK (note_mode IN ('required', 'optional', 'off'));
