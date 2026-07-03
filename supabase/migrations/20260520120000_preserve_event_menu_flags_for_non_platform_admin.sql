-- Event admins may update events but must not change hub tiles or in-app menu flags.
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
  NEW.menu_show_1on1 := OLD.menu_show_1on1;
  NEW.menu_show_live_wall := OLD.menu_show_live_wall;
  NEW.menu_show_solution_providers := OLD.menu_show_solution_providers;
  NEW.menu_show_scan_badge := OLD.menu_show_scan_badge;
  NEW.menu_show_notes := OLD.menu_show_notes;
  NEW.menu_show_agenda := OLD.menu_show_agenda;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_admin_console_tiles ON public.events;
CREATE TRIGGER preserve_admin_console_tiles
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  WHEN (
    NEW.admin_console_tiles IS DISTINCT FROM OLD.admin_console_tiles
    OR NEW.menu_show_1on1 IS DISTINCT FROM OLD.menu_show_1on1
    OR NEW.menu_show_live_wall IS DISTINCT FROM OLD.menu_show_live_wall
    OR NEW.menu_show_solution_providers IS DISTINCT FROM OLD.menu_show_solution_providers
    OR NEW.menu_show_scan_badge IS DISTINCT FROM OLD.menu_show_scan_badge
    OR NEW.menu_show_notes IS DISTINCT FROM OLD.menu_show_notes
    OR NEW.menu_show_agenda IS DISTINCT FROM OLD.menu_show_agenda
  )
  EXECUTE FUNCTION public.preserve_admin_console_tiles_for_non_platform_admin();
