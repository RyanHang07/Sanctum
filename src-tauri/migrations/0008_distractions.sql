-- One list of distractions for every focus session (decided 2026-09-29), replacing per-profile
-- seals and allowlist mode. Flagged = blocked while sealed and counted as distracting time.

CREATE TABLE distractions (
  id         INTEGER PRIMARY KEY,
  -- app: lowercase exe. site: bare host plus optional path ("youtube.com/shorts"). keyword: window or tab title text.
  kind       TEXT    NOT NULL CHECK (kind IN ('app', 'site', 'keyword')),
  value      TEXT    NOT NULL,
  label      TEXT,
  -- app: where it was found, for its icon.
  path       TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, value)
);

-- Pages under a flagged site that stay open ("youtube.com/@mitocw").
CREATE TABLE distraction_allows (
  id             INTEGER PRIMARY KEY,
  distraction_id INTEGER NOT NULL REFERENCES distractions(id) ON DELETE CASCADE,
  prefix         TEXT    NOT NULL,
  UNIQUE (distraction_id, prefix)
);

-- Every profile's seals join the one list.
INSERT OR IGNORE INTO distractions (kind, value, label, path, created_at)
SELECT CASE kind WHEN 'app' THEN 'app' WHEN 'domain' THEN 'site' ELSE 'keyword' END, value, label, path, 0
FROM profile_rules WHERE kind IN ('app', 'domain', 'title') ORDER BY id;

INSERT OR IGNORE INTO distraction_allows (distraction_id, prefix)
SELECT d.id, e.prefix
FROM site_exceptions e
JOIN profile_rules r ON r.id = e.rule_id
JOIN distractions d ON d.kind = 'site' AND d.value = r.value;

DROP TABLE site_exceptions;
DELETE FROM profile_rules WHERE kind IN ('app', 'domain', 'title');
-- Allowlist mode is gone; the column stays for old databases but is always 0.
UPDATE profiles SET allowlist_mode = 0;
DELETE FROM settings WHERE key IN ('allowlist_always_allowed', 'always_allowed_seeded');
