-- Per-user: skip "session starting soon" push/in-app when previous bookmarked session same day is same room/location.
-- Default true (less noise at conferences). Set false to always receive reminders.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS session_reminder_skip_same_room boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.users.session_reminder_skip_same_room IS
  'When true, notify-event-starting-soon skips users whose previous bookmarked session same day shares the same room/location.';
