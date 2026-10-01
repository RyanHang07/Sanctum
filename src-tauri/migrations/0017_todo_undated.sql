-- v0.1: Pending. An item with no day yet is parked on a week: undated = 1, and due_date holds
-- that week's Monday. It never has a time, so it never syncs to Google.
ALTER TABLE todos ADD COLUMN undated INTEGER NOT NULL DEFAULT 0;
