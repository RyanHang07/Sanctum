-- Daily sessions for checkbox routines (separate from counter/amount routines).
-- A routine can require N completions per day; done only when completed >= sessions_per_day.
ALTER TABLE daily_goals ADD COLUMN sessions_per_day INTEGER NOT NULL DEFAULT 1 CHECK (sessions_per_day >= 1);

-- Track per-day completion progress for routines (0..sessions_per_day).
ALTER TABLE daily_goal_checks ADD COLUMN completed INTEGER NOT NULL DEFAULT 1 CHECK (completed >= 0);
