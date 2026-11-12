-- M10: Roll back emergency push_token SELECT grant (20260821013000).
-- Current mobile + cadmin clients use explicit column lists or get_*_user_profile RPCs.
-- Push registration still works via UPDATE (grant unchanged). Edge functions use service_role.

REVOKE SELECT (push_token) ON TABLE public.users FROM authenticated;

COMMENT ON COLUMN public.users.push_token IS
  'Device push token. Not selectable by authenticated clients; use get_my_user_profile() for self read. UPDATE allowed for self registration via RLS.';
