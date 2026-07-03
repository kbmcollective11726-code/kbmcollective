ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS badge_show_event_name boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.badge_show_event_name IS
  'When false, attendee badges hide the event name line.';
