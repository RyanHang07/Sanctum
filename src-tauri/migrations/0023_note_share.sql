-- v0.2: a note shared as a live, end-to-end encrypted link. Kept here so pushes continue
-- after a restart: the link's token and expiry, its key (which never leaves this PC except
-- inside the link you hand over), and each uploaded image's signed URL (JSON).
ALTER TABLE notes ADD COLUMN share_token TEXT;
ALTER TABLE notes ADD COLUMN share_expires_at INTEGER;
ALTER TABLE notes ADD COLUMN share_key TEXT;
ALTER TABLE notes ADD COLUMN share_images TEXT;
