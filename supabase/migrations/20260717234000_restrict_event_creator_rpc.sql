-- The function inherited PostgreSQL's default PUBLIC execute grant.
REVOKE ALL ON FUNCTION public.add_creator_as_event_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_creator_as_event_admin() TO authenticated, service_role;
