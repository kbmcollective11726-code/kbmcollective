-- Scan badge in app: off by default; only platform admin re-enables (Event admin tiles).
UPDATE public.events
SET
  platform_menu_show_scan_badge = false,
  menu_show_scan_badge = false;

COMMENT ON COLUMN public.events.platform_menu_show_scan_badge IS
  'Platform admin allows Scan badge in the app hamburger (event admins cannot toggle).';
COMMENT ON COLUMN public.events.menu_show_scan_badge IS
  'In-app Scan badge visibility; set with platform_menu_show_scan_badge by platform admin.';
