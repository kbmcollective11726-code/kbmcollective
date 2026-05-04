-- Toggle Scan badge visibility in app hamburger menu (per event).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS menu_show_scan_badge BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.menu_show_scan_badge IS
  'When false, hide Scan badge from the app hamburger menu.';
