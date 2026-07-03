-- Per-event admin console hub tiles visible to event admins (platform admins always see all).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS admin_console_tiles text[] NOT NULL
  DEFAULT ARRAY['members', 'schedule', 'agenda_print', 'photos', 'announcements']::text[];

COMMENT ON COLUMN public.events.admin_console_tiles IS
  'Admin console hub tile keys shown to event admins. Platform admins always see every tile and are the only role that may change this list.';

-- Event admins may update events but must not change admin_console_tiles.
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_admin_console_tiles ON public.events;
CREATE TRIGGER preserve_admin_console_tiles
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  WHEN (NEW.admin_console_tiles IS DISTINCT FROM OLD.admin_console_tiles)
  EXECUTE FUNCTION public.preserve_admin_console_tiles_for_non_platform_admin();
