-- Safe member profile card for mobile (avoids direct users column privilege pitfalls).
CREATE OR REPLACE FUNCTION public.get_visible_user_profile(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  avatar_url text,
  title text,
  company text,
  linkedin_url text,
  bio text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  is_platform_admin boolean,
  last_login_at timestamptz,
  session_reminder_skip_same_room boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.email,
    u.full_name,
    u.avatar_url,
    u.title,
    u.company,
    u.linkedin_url,
    u.bio,
    u.is_active,
    u.created_at,
    u.updated_at,
    u.is_platform_admin,
    u.last_login_at,
    u.session_reminder_skip_same_room
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
        JOIN public.event_members them ON them.event_id = me.event_id
        WHERE me.user_id = auth.uid()
          AND them.user_id = u.id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_visible_user_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visible_user_profile(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_visible_user_profile(uuid) IS
  'Safe profile card for self, platform admin, or shared-event co-member. Avoids direct users column privilege issues on mobile.';
