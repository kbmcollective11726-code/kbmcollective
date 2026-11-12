-- RLS needs this helper for the signed-in user's relationships, but callers
-- must not use it as an oracle for arbitrary pairs of other users.
CREATE OR REPLACE FUNCTION public.users_have_block(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a IS NOT NULL
    AND b IS NOT NULL
    AND (
      auth.role() = 'service_role'
      OR auth.uid() = a
      OR auth.uid() = b
      OR public.is_platform_admin(auth.uid())
    )
    AND EXISTS (
      SELECT 1
      FROM public.blocked_users bu
      WHERE (bu.blocker_id = a AND bu.blocked_user_id = b)
         OR (bu.blocker_id = b AND bu.blocked_user_id = a)
    );
$$;

REVOKE ALL ON FUNCTION public.users_have_block(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.users_have_block(uuid, uuid)
  TO authenticated, service_role;
