-- Split hamburger menu sponsor placement: header (beside "Menu") vs footer ("Sponsored by" block).
ALTER TABLE public.event_sponsors
  ADD COLUMN IF NOT EXISTS show_in_hamburger_header boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_in_hamburger_footer boolean NOT NULL DEFAULT true;

-- Match existing "Show in hamburger" for both (was one toggle for both).
UPDATE public.event_sponsors
SET
  show_in_hamburger_header = show_in_hamburger,
  show_in_hamburger_footer = show_in_hamburger
WHERE true;
