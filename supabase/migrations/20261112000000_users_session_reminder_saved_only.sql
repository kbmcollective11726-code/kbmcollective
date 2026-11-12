-- Per-user: only send "session starting soon" for sessions the user saved (bookmarked).
-- Default true (fewer alerts). Set false to get a reminder for every session.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS session_reminder_saved_only boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.users.session_reminder_saved_only IS
  'When true, notify-event-starting-soon only notifies users who bookmarked the session.';

GRANT SELECT (session_reminder_saved_only) ON TABLE public.users TO authenticated;
GRANT UPDATE (session_reminder_saved_only) ON TABLE public.users TO authenticated;
