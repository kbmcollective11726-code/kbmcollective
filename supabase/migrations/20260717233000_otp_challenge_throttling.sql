-- Bind OTP challenges to the Auth session and persist resend throttling.
DELETE FROM public.platform_admin_login_otps;

ALTER TABLE public.platform_admin_login_otps
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_window_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.platform_admin_login_otps
  DROP CONSTRAINT IF EXISTS platform_admin_login_otps_pkey;

ALTER TABLE public.platform_admin_login_otps
  ALTER COLUMN session_id SET NOT NULL,
  ALTER COLUMN sent_at SET DEFAULT now(),
  ALTER COLUMN sent_at SET NOT NULL,
  ALTER COLUMN send_window_started_at SET DEFAULT now(),
  ALTER COLUMN send_window_started_at SET NOT NULL,
  ADD PRIMARY KEY (user_id, session_id);

COMMENT ON COLUMN public.platform_admin_login_otps.session_id IS
  'Supabase Auth JWT session_id that requested this challenge.';
