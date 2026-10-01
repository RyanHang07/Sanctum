-- v0.1: a session can be for one Today task (a one-time item or a routine on a date). The title
-- is copied so the link still reads after the task is renamed or deleted.
ALTER TABLE sessions ADD COLUMN task_kind TEXT CHECK (task_kind IN ('todo', 'routine'));
ALTER TABLE sessions ADD COLUMN task_id INTEGER;
ALTER TABLE sessions ADD COLUMN task_date TEXT;
ALTER TABLE sessions ADD COLUMN task_title TEXT;
