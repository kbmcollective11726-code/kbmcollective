-- Per-event From address for Resend registration emails.
ALTER TABLE public.event_matchmaking_settings
  ADD COLUMN IF NOT EXISTS registration_from_email TEXT;

COMMENT ON COLUMN public.event_matchmaking_settings.registration_from_email IS
  'Resend From for registration emails, e.g. Opal HR <opal_hr@kbmcollective.org>. Falls back to REGISTRATION_FROM_EMAIL env.';
