-- Event admins may toggle menu_show_* only within platform_menu_show_*; cannot change platform caps or hub tiles.
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_admin_console_tiles ON public.events;
CREATE TRIGGER preserve_admin_console_tiles
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_admin_console_tiles_for_non_platform_admin();
