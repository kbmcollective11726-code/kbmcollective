-- Add targeting and scheduling columns to announcements
-- Run in Supabase SQL editor

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'all' CHECK (target_type IN ('all', 'audience', 'specific')),
  ADD COLUMN IF NOT EXISTS target_audience TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_user_ids UUID[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.announcements.target_type IS 'all = everyone, audience = by role, specific = by user ids';
COMMENT ON COLUMN public.announcements.target_audience IS 'attendee, speaker, vendor - used when target_type = audience';
COMMENT ON COLUMN public.announcements.target_user_ids IS 'Used when target_type = specific';
COMMENT ON COLUMN public.announcements.scheduled_at IS 'When to send - null = send immediately';
COMMENT ON COLUMN public.announcements.sent_at IS 'When actually sent (for scheduled)';
