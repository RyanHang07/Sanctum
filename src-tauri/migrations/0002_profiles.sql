-- Milestone 2: profile editor + launcher.
-- work_types: JSON array of catalog work types the profile was built from (shown as chips in Setup).
-- profile_rules.label: display name ("Discord"); profile_rules.path: last known launch target (.lnk or .exe).
-- For app / launch_app rules, value is the lowercase exe name, which is what blocking matches on.

ALTER TABLE profiles ADD COLUMN work_types TEXT NOT NULL DEFAULT '[]';

ALTER TABLE profile_rules ADD COLUMN label TEXT;
ALTER TABLE profile_rules ADD COLUMN path TEXT;
ALTER TABLE profile_rules ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX idx_profile_rules_unique ON profile_rules(profile_id, kind, value);
