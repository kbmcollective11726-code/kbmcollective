-- Prevent anon UUID-oracle probing via is_platform_admin / is_account_active.
-- When auth.uid() is null (anon), always return false without honoring arbitrary p_user_id.
-- Authenticated callers and SECURITY DEFINER policy evaluation with a real uid still work.

CREATE OR REPLACE FUNCTION public.is_platform_admin(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    ELSE COALESCE((
      SELECT u.is_platform_admin = true
        AND u.is_active IS NOT FALSE
      FROM public.users u
      WHERE u.id = COALESCE(p_user_id, auth.uid())
        AND COALESCE(p_user_id, auth.uid()) IS NOT NULL
    ), false)
  END;
$$;

COMMENT ON FUNCTION public.is_platform_admin(uuid) IS
  'Returns true for an active platform-admin account. Anon (no auth.uid) always false to prevent UUID probing. Web OTP is enforced by the web app, not this helper.';

CREATE OR REPLACE FUNCTION public.is_account_active(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    ELSE COALESCE((
      SELECT u.is_active IS NOT FALSE
      FROM public.users u
      WHERE u.id = COALESCE(p_user_id, auth.uid())
        AND COALESCE(p_user_id, auth.uid()) IS NOT NULL
    ), false)
  END;
$$;

COMMENT ON FUNCTION public.is_account_active(uuid) IS
  'Returns true when the account is active. Anon (no auth.uid) always false to prevent UUID probing.';
