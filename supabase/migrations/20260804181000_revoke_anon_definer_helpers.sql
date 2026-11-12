-- M5: Reduce anon EXECUTE on DEFINER helpers that are not needed for public RLS.
REVOKE EXECUTE ON FUNCTION public.is_event_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_can_view_announcement(uuid, text, text[], uuid[]) FROM anon;

COMMENT ON FUNCTION public.is_event_admin(uuid) IS
  'Event-admin check for authenticated RLS/RPC. Anon EXECUTE revoked (M5).';
