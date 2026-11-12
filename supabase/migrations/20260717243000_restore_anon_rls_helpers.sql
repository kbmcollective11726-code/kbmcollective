-- Anonymous table policies reference these predicates. They are safe to expose:
-- with no auth.uid() they return false, while revoking them makes PostgreSQL
-- reject otherwise-public rows before evaluating policy branches.
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_event_admin(uuid) TO anon;
