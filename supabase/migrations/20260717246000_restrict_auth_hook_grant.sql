-- Supabase Auth invokes this hook as supabase_auth_admin. It is not a public
-- PostgREST RPC and must not inherit PostgreSQL's default PUBLIC grant.
REVOKE ALL ON FUNCTION public.hook_password_verification_attempt(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hook_password_verification_attempt(jsonb)
  TO supabase_auth_admin;
