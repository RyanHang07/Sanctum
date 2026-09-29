-- Milestone 4: activity + idle tracking (SPEC 4.7, 4.8).
-- sessions.idle_ms: idle time during the seal; the end time moves later by this much.
-- classification_rules.source: 'catalog' rows are seeded defaults, 'user' rows were added in Setup.

ALTER TABLE sessions ADD COLUMN idle_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE classification_rules ADD COLUMN source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('catalog', 'user'));
CREATE UNIQUE INDEX idx_classification_unique ON classification_rules(match_kind, pattern);

CREATE INDEX idx_idle_started ON idle_periods(started_at);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('idle_threshold_min', '3'),
  ('activity_retention_days', '30'),
  ('passive_apps', 'zoom.exe, teams.exe, ms-teams.exe, webex.exe, ciscocollabhost.exe'),
  ('private_apps', '1password.exe, bitwarden.exe, keepassxc.exe, keepass.exe');
