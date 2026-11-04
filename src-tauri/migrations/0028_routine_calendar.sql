-- Routines stay off Google Calendar unless you turn one on (decided 2026-11-04): they're routine.
-- Everything starts off, and what's already up comes down on the next sync.
ALTER TABLE daily_goals ADD COLUMN on_calendar INTEGER NOT NULL DEFAULT 0;

INSERT INTO gcal_outbox (kind, ref_id, created_at)
SELECT 'routine', id, 0 FROM daily_goals
WHERE gcal_event_id IS NOT NULL AND EXISTS (SELECT 1 FROM settings WHERE key = 'gcal_account');
