-- Toggle visibility of optional nav items in the mobile hamburger menu (per event).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS menu_show_1on1 BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS menu_show_live_wall BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS menu_show_solution_providers BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.menu_show_1on1 IS 'When false, hide 1:1 Meetings from the app hamburger menu.';
COMMENT ON COLUMN public.events.menu_show_live_wall IS 'When false, hide Live wall from the app hamburger menu.';
COMMENT ON COLUMN public.events.menu_show_solution_providers IS 'When false, hide Solution Provider from the app hamburger menu.';
