-- Verify ASVS RLS + live wall RPCs
SELECT policyname, tablename, roles::text AS roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users', 'posts', 'comments', 'event_members')
  AND cmd = 'SELECT'
ORDER BY tablename, policyname;

SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND (proname LIKE 'get_live_wall%' OR proname IN ('list_live_wall_events', 'is_live_wall_event', 'is_event_member'))
ORDER BY 1;

SELECT COUNT(*) AS events_with_wall
FROM public.events
WHERE live_wall_enabled = true;
