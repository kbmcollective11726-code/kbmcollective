-- Default to a "starting soon" reminder for every session; users opt in to saved-sessions-only.
ALTER TABLE public.users
  ALTER COLUMN session_reminder_saved_only SET DEFAULT false;

UPDATE public.users
SET session_reminder_saved_only = false
WHERE session_reminder_saved_only = true;

COMMENT ON COLUMN public.users.session_reminder_saved_only IS
  'When true, notify-event-starting-soon only notifies users who bookmarked the session. Default false (every session).';
