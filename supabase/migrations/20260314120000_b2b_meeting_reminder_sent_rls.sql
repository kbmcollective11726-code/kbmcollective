-- Lock down b2b_meeting_reminder_sent: clients use service role via Edge Functions only.
ALTER TABLE public.b2b_meeting_reminder_sent ENABLE ROW LEVEL SECURITY;
