-- Optional placements for compact sponsor strips (Schedule, Feed, join-by-code screen).
ALTER TABLE public.event_sponsors
  ADD COLUMN IF NOT EXISTS show_on_schedule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_on_feed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_on_join_gate boolean NOT NULL DEFAULT false;
