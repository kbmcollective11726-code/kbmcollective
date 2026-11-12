-- Emergency for event day: installed builds call users?select=* on member profiles.
-- That fails with "permission denied for table users" when push_token SELECT is revoked.
-- Row access remains RLS-scoped. Newer app builds should not select push_token.
GRANT SELECT (push_token) ON TABLE public.users TO authenticated;

COMMENT ON COLUMN public.users.push_token IS
  'Device push token. SELECT temporarily granted so legacy select=* profile queries work under RLS. Prefer get_my_user_profile for self reads; do not request this column from clients.';
