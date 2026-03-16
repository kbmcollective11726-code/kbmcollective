-- Allow multiple session types stored as comma-separated (e.g. breakout,workshop).
-- Run in Supabase SQL Editor if you get a constraint error when saving multiple types.

ALTER TABLE public.schedule_sessions
  DROP CONSTRAINT IF EXISTS schedule_sessions_session_type_check;
