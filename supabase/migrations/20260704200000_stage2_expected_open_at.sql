-- Optional date shown on Stage 2 holding screen and in registration confirmation emails.
ALTER TABLE public.event_matchmaking_settings
  ADD COLUMN IF NOT EXISTS stage2_expected_open_at TIMESTAMPTZ;

COMMENT ON COLUMN public.event_matchmaking_settings.stage2_expected_open_at IS
  'When set, shown to registrants on the holding screen and in confirmation email if Stage 2 is not yet active.';
