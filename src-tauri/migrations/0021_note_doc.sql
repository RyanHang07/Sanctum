-- v0.2: notes become block documents (lists, checklists, tables, callouts, links to Sanctum).
-- doc holds the editor's JSON; body stays the plain text of it, for search, previews, and
-- exports. Old notes have no doc yet: the editor converts their body the first time they open.
ALTER TABLE notes ADD COLUMN doc TEXT;
