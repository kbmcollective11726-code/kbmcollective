-- Platform ceiling for in-app menu items event admins may toggle.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS platform_menu_show_agenda boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_menu_show_1on1 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_menu_show_scan_badge boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_menu_show_solution_providers boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_menu_show_live_wall boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_menu_show_notes boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.platform_menu_show_agenda IS
  'Platform admin allows Agenda in app; event admin controls menu_show_agenda.';
COMMENT ON COLUMN public.events.platform_menu_show_1on1 IS
  'Platform admin allows 1:1 Meetings in app; event admin controls menu_show_1on1.';
COMMENT ON COLUMN public.events.platform_menu_show_scan_badge IS
  'Platform admin allows Scan badge in app; event admin controls menu_show_scan_badge.';
COMMENT ON COLUMN public.events.platform_menu_show_solution_providers IS
  'Platform admin allows Solution Providers in app; event admin controls menu_show_solution_providers.';
COMMENT ON COLUMN public.events.platform_menu_show_live_wall IS
  'Platform admin allows Live wall in app; event admin controls menu_show_live_wall.';
COMMENT ON COLUMN public.events.platform_menu_show_notes IS
  'Platform admin allows Notes in app (platform-only toggle on Event admin tiles).';

-- Backfill: existing on = platform allowed (event admin keeps menu_show_* as-is).
UPDATE public.events SET
  platform_menu_show_agenda = COALESCE(menu_show_agenda, true),
  platform_menu_show_1on1 = COALESCE(menu_show_1on1, false),
  platform_menu_show_scan_badge = COALESCE(menu_show_scan_badge, false),
  platform_menu_show_solution_providers = COALESCE(menu_show_solution_providers, false),
  platform_menu_show_live_wall = COALESCE(menu_show_live_wall, false),
  platform_menu_show_notes = COALESCE(menu_show_notes, false);
