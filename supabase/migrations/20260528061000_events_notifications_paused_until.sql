ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS notifications_paused_until timestamptz NULL;

COMMENT ON COLUMN public.events.notifications_paused_until IS
  'Optional auto-unmute timestamp for event notifications.';
