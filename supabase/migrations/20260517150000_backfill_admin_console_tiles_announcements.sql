-- Events created before announcements was added to the default still store the 4-tile list.
UPDATE public.events
SET admin_console_tiles = ARRAY['members', 'schedule', 'agenda_print', 'photos', 'announcements']::text[]
WHERE admin_console_tiles = ARRAY['members', 'schedule', 'agenda_print', 'photos']::text[];
