-- Security: enable RLS on tables flagged by Supabase linter (were off on this project).
-- b2b_meeting_reminder_sent: Edge Functions use service role; no client policies needed.
-- chat_group_event: junction for group↔event; accessed via SECURITY DEFINER helpers, not direct client reads.

ALTER TABLE public.b2b_meeting_reminder_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_event ENABLE ROW LEVEL SECURITY;
