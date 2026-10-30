-- v0.3.1 (decided 2026-10-30): the Monday card's two questions, kept per week.
CREATE TABLE weekly_reviews (
  week TEXT PRIMARY KEY,
  worked TEXT,
  change TEXT,
  created_at INTEGER NOT NULL
);
