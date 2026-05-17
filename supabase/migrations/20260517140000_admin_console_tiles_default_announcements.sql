-- Default hub tiles for event admins: members, schedule, agenda, photos, announcements.
ALTER TABLE public.events
  ALTER COLUMN admin_console_tiles
  SET DEFAULT ARRAY['members', 'schedule', 'agenda_print', 'photos', 'announcements']::text[];

COMMENT ON COLUMN public.events.admin_console_tiles IS
  'Admin console hub tile keys for event admins. Default: members, schedule, agenda_print, photos, announcements. Platform admins always see all tiles.';
