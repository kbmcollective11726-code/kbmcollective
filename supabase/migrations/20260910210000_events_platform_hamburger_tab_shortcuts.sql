-- Platform admin: optionally duplicate bottom tabs in the hamburger menu (default off).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS platform_hamburger_show_info boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_hamburger_show_feed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_hamburger_show_agenda boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_hamburger_show_community boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_hamburger_show_rank boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.platform_hamburger_show_info IS
  'Platform admin: show Info in hamburger (bottom tab always available).';
COMMENT ON COLUMN public.events.platform_hamburger_show_feed IS
  'Platform admin: show Feed in hamburger (bottom tab always available).';
COMMENT ON COLUMN public.events.platform_hamburger_show_agenda IS
  'Platform admin: show Agenda in hamburger when event admin has Agenda visible.';
COMMENT ON COLUMN public.events.platform_hamburger_show_community IS
  'Platform admin: show Community in hamburger (bottom tab always available).';
COMMENT ON COLUMN public.events.platform_hamburger_show_rank IS
  'Platform admin: show Rank in hamburger (bottom tab always available).';

-- Keep event-admin clamp behavior; also lock hamburger shortcuts to platform admins.
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
  NEW.platform_hamburger_show_info := OLD.platform_hamburger_show_info;
  NEW.platform_hamburger_show_feed := OLD.platform_hamburger_show_feed;
  NEW.platform_hamburger_show_agenda := OLD.platform_hamburger_show_agenda;
  NEW.platform_hamburger_show_community := OLD.platform_hamburger_show_community;
  NEW.platform_hamburger_show_rank := OLD.platform_hamburger_show_rank;

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

DROP TRIGGER IF EXISTS preserve_admin_console_tiles ON public.events;
CREATE TRIGGER preserve_admin_console_tiles
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_admin_console_tiles_for_non_platform_admin();
