-- v0.3 Stats › Activity: reclassify an app or site "only in <profile>". A profile's exceptions
-- are checked before the everywhere rules (classification_rules) while that profile is sealed.
CREATE TABLE classification_exceptions (
  id         INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  match_kind TEXT    NOT NULL CHECK (match_kind IN ('exe', 'domain')),
  pattern    TEXT    NOT NULL,
  category   TEXT    NOT NULL CHECK (category IN ('productive', 'neutral', 'distracting')),
  UNIQUE (profile_id, match_kind, pattern)
);
