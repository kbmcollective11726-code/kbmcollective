-- Platform administrators are the highest application role on every client.
-- Email OTP remains a web-interface gate, but database authorization requires
-- only an active authenticated platform-admin account.

CREATE OR REPLACE FUNCTION public.is_platform_admin(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT u.is_platform_admin = true
      AND u.is_active IS NOT FALSE
    FROM public.users u
    WHERE u.id = p_user_id
      AND p_user_id IS NOT NULL
  ), false);
$$;

COMMENT ON FUNCTION public.is_platform_admin(uuid) IS
  'Returns true for any active platform-admin account. Web OTP is enforced by the web application, not this database authorization helper.';
