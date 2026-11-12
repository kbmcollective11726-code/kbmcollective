-- events_select_perm EXISTS-subqueries reference event_members.
-- Anon lacked SELECT privilege, so even is_active=true public reads failed with
-- "permission denied for table event_members".
-- RLS stays on; event_members_select_perm is authenticated-only, so anon still
-- gets zero rows from direct/subquery SELECTs (EXISTS is false).
GRANT SELECT ON TABLE public.event_members TO anon;

-- events RLS also calls these helpers; both return false for null auth.uid().
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_account_active(uuid) TO anon;

COMMENT ON TABLE public.event_members IS
  'Membership rows. Anon has table SELECT for events RLS subquery evaluation only; RLS denies anon row visibility (select policy is authenticated-only).';
