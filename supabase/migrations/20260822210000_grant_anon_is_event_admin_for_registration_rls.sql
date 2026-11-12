-- Public registration RLS policies reference is_event_admin().
-- Anon must EXECUTE it for policy evaluation; the function returns false when auth.uid() is null
-- (via is_account_active), so this does not restore UUID-oracle probing.
GRANT EXECUTE ON FUNCTION public.is_event_admin(uuid) TO anon;

COMMENT ON FUNCTION public.is_event_admin(uuid) IS
  'Event-admin check for RLS/RPC. Anon EXECUTE required so public registration policies can evaluate; returns false when auth.uid() is null.';
