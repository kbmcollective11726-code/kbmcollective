-- M3: Narrow co-member phone exposure (email stays selectable for networking UX).
-- Direct SELECT of phone is revoked; self/admin/co-member phone via get_user_networking_contact.

REVOKE SELECT (phone) ON TABLE public.users FROM PUBLIC;
REVOKE SELECT (phone) ON TABLE public.users FROM anon;
REVOKE SELECT (phone) ON TABLE public.users FROM authenticated;

-- Keep self-update of phone (RLS still scopes rows).
GRANT UPDATE (phone) ON TABLE public.users TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_networking_contact(p_user_id uuid)
RETURNS TABLE (user_id uuid, email text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.email, u.phone
  FROM public.users u
  WHERE u.id = p_user_id
    AND auth.uid() IS NOT NULL
    AND public.is_account_active(auth.uid())
    AND (
      u.id = auth.uid()
      OR public.is_platform_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.event_members me
        JOIN public.event_members them
          ON them.event_id = me.event_id
         AND them.user_id = p_user_id
        WHERE me.user_id = auth.uid()
          AND COALESCE(me.is_active, true) = true
          AND COALESCE(them.is_active, true) = true
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_user_networking_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_networking_contact(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_user_networking_contact(uuid) IS
  'Returns email/phone for self, platform admin, or shared active event co-member. users.phone is not directly selectable.';
