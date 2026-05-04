-- Optional per-event IANA zone for agenda 5-min reminders (notify-event-starting-soon).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS reminder_timezone TEXT;

COMMENT ON COLUMN public.events.reminder_timezone IS
  'IANA zone e.g. America/Chicago; overrides Edge secret SESSION_REMINDER_TIMEZONE when set.';
