-- v0.1 quiet hours: the Distractions list is blocked on a schedule (settings key quiet_hours).
-- A 15-minute pause takes a reason; each one is logged here for your own review.
CREATE TABLE quiet_pauses (
  id     INTEGER PRIMARY KEY,
  ts     INTEGER NOT NULL,
  reason TEXT    NOT NULL
);
