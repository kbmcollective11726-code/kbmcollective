-- Default in-app hamburger: Agenda on; 1:1, scan badge, notes, live wall, solution providers off.
ALTER TABLE public.events
  ALTER COLUMN menu_show_1on1 SET DEFAULT false,
  ALTER COLUMN menu_show_live_wall SET DEFAULT false,
  ALTER COLUMN menu_show_solution_providers SET DEFAULT false,
  ALTER COLUMN menu_show_scan_badge SET DEFAULT false,
  ALTER COLUMN menu_show_notes SET DEFAULT false,
  ALTER COLUMN menu_show_agenda SET DEFAULT true;

COMMENT ON COLUMN public.events.menu_show_1on1 IS 'When false, hide 1:1 Meetings from the app hamburger menu. Default off for new events.';
COMMENT ON COLUMN public.events.menu_show_live_wall IS 'When false, hide Live wall from the app hamburger menu. Default off for new events.';
COMMENT ON COLUMN public.events.menu_show_solution_providers IS 'When false, hide Solution Providers from the app hamburger menu. Default off for new events.';
COMMENT ON COLUMN public.events.menu_show_scan_badge IS 'When false, hide Scan badge from the app hamburger menu. Default off for new events.';
COMMENT ON COLUMN public.events.menu_show_notes IS 'When false, hide Notes from the app hamburger menu. Default off for new events.';
