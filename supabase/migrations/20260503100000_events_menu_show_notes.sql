-- Hamburger: Notes (badge scan log) visibility for event admins and vendor reps.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS menu_show_notes BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.menu_show_notes IS
  'When false, hide Notes from the app hamburger menu (event admins and vendor reps only see it when true).';
