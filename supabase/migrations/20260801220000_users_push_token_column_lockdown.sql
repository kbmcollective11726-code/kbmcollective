-- H4 fix: table-level ALL on users made column REVOKE ineffective.
-- Strip authenticated table privileges, then grant column allowlists
-- excluding push_token / password_reset_blocked from SELECT.

REVOKE ALL ON TABLE public.users FROM PUBLIC;
REVOKE ALL ON TABLE public.users FROM anon;
REVOKE ALL ON TABLE public.users FROM authenticated;

GRANT SELECT (
  id,
  email,
  full_name,
  avatar_url,
  title,
  company,
  linkedin_url,
  bio,
  phone,
  is_active,
  created_at,
  updated_at,
  is_platform_admin,
  last_login_at,
  session_reminder_skip_same_room
) ON TABLE public.users TO authenticated;

-- Profile edits + device push registration (row scope still enforced by RLS / triggers)
GRANT UPDATE (
  email,
  full_name,
  avatar_url,
  title,
  company,
  linkedin_url,
  bio,
  phone,
  push_token,
  updated_at,
  last_login_at,
  session_reminder_skip_same_room
) ON TABLE public.users TO authenticated;

COMMENT ON COLUMN public.users.push_token IS
  'Device push token. Not selectable by authenticated clients; use get_my_user_profile() for self read. UPDATE allowed for self registration via RLS.';
