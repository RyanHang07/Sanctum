-- v0.1: one-time items keep the order you drag them into on Home (untimed ones; timed items
-- sort by time). Existing items keep their creation order.
ALTER TABLE todos ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
UPDATE todos SET sort = id;
