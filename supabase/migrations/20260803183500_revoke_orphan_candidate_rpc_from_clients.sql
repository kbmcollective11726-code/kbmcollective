REVOKE ALL ON FUNCTION public.list_orphan_signup_candidates(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_orphan_signup_candidates(integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.list_orphan_signup_candidates(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_orphan_signup_candidates(integer, integer) TO service_role;
