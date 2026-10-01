-- v0.1 planner depth: an occurrence remembers its recurring series, so Week can edit or delete
-- the whole series. Filled in on the next sync.
ALTER TABLE gcal_events ADD COLUMN series_id TEXT;
