-- Uptime (GetTickCount64 ms) at each heartbeat, so a restart in the same boot can't be fooled by
-- a wall clock set forward while Sanctum was down (2026-11-17).
ALTER TABLE sessions ADD COLUMN last_seen_uptime INTEGER;
