-- Notes on badge scans and 1:1 meetings, separate from the Notes item in the app menu.
-- On by default so existing events keep the notes box.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS menu_show_scan_notes BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS platform_menu_show_scan_notes BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.menu_show_scan_notes IS
  'When false, vendors do not get a notes box on badge scans or on the 1:1 Meetings page.';
COMMENT ON COLUMN public.events.platform_menu_show_scan_notes IS
  'Platform ceiling for menu_show_scan_notes.';
