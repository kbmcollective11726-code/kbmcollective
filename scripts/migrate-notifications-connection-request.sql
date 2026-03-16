-- Allow 'connection_request' in notifications.type for connection request notifications.
-- Run in Supabase SQL Editor if the constraint name differs (check with \d public.notifications).

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like', 'comment', 'message', 'announcement', 'points', 'badge', 'meeting', 'schedule_change', 'system', 'connection_request'));
