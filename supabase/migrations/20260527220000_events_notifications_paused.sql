ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS notifications_paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.notifications_paused IS
  'When true, event-scoped notifications are muted (in-app rows and push).';
