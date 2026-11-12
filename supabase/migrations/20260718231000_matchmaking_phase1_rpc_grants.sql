-- Supabase may provision explicit default EXECUTE grants for anon.
-- These participant/admin RPCs must never be callable without authentication.

REVOKE ALL ON FUNCTION public.set_my_matchmaking_availability(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_matchmaking_availability(UUID, UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_matchmaking_availability(UUID, UUID[])
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.schedule_matchmaking_review(
  UUID, UUID, UUID, TEXT, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_matchmaking_review(
  UUID, UUID, UUID, TEXT, BOOLEAN
) FROM anon;
GRANT EXECUTE ON FUNCTION public.schedule_matchmaking_review(
  UUID, UUID, UUID, TEXT, BOOLEAN
) TO authenticated, service_role;

