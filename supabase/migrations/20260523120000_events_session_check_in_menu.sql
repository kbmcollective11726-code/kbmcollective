-- Session check-in in hamburger: platform ceiling + event admin toggle.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS menu_show_session_check_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_menu_show_session_check_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.menu_show_session_check_in IS
  'Event admin shows Session check-in in app hamburger when platform allowed.';
COMMENT ON COLUMN public.events.platform_menu_show_session_check_in IS
  'Platform allows Session check-in in app hamburger; pairs with session_attendance hub tile.';

-- Events that already had session attendance hub tile: enable platform + menu.
UPDATE public.events SET
  platform_menu_show_session_check_in = true,
  menu_show_session_check_in = true
WHERE 'session_attendance' = ANY(COALESCE(admin_console_tiles, ARRAY[]::text[]));

CREATE OR REPLACE FUNCTION public.preserve_admin_console_tiles_for_non_platform_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_platform_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  NEW.admin_console_tiles := OLD.admin_console_tiles;
  NEW.platform_menu_show_agenda := OLD.platform_menu_show_agenda;
  NEW.platform_menu_show_1on1 := OLD.platform_menu_show_1on1;
  NEW.platform_menu_show_scan_badge := OLD.platform_menu_show_scan_badge;
  NEW.platform_menu_show_solution_providers := OLD.platform_menu_show_solution_providers;
  NEW.platform_menu_show_live_wall := OLD.platform_menu_show_live_wall;
  NEW.platform_menu_show_notes := OLD.platform_menu_show_notes;
  NEW.platform_menu_show_session_check_in := OLD.platform_menu_show_session_check_in;

  IF NOT OLD.platform_menu_show_agenda THEN
    NEW.menu_show_agenda := false;
  END IF;
  IF NOT OLD.platform_menu_show_1on1 THEN
    NEW.menu_show_1on1 := false;
  END IF;
  IF NOT OLD.platform_menu_show_scan_badge THEN
    NEW.menu_show_scan_badge := false;
  END IF;
  IF NOT OLD.platform_menu_show_solution_providers THEN
    NEW.menu_show_solution_providers := false;
  END IF;
  IF NOT OLD.platform_menu_show_live_wall THEN
    NEW.menu_show_live_wall := false;
  END IF;
  IF NOT OLD.platform_menu_show_notes THEN
    NEW.menu_show_notes := false;
  END IF;
  IF NOT OLD.platform_menu_show_session_check_in THEN
    NEW.menu_show_session_check_in := false;
  END IF;

  RETURN NEW;
END;
$$;
