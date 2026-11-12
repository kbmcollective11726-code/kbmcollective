-- Previous data migration could not clear platform_menu_show_scan_badge because
-- preserve_admin_console_tiles restores it when auth.uid() is not a platform admin.
ALTER TABLE public.events DISABLE TRIGGER preserve_admin_console_tiles;

UPDATE public.events
SET
  platform_menu_show_scan_badge = false,
  menu_show_scan_badge = false;

ALTER TABLE public.events ENABLE TRIGGER preserve_admin_console_tiles;

ALTER TABLE public.events
  ALTER COLUMN platform_menu_show_scan_badge SET DEFAULT false,
  ALTER COLUMN menu_show_scan_badge SET DEFAULT false;
