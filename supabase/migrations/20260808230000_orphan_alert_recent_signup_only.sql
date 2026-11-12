-- Orphan / no-roster security alerts: only recent sign-ups, clearer wording.
-- Deleting an event removes memberships and was incorrectly emailing
-- "Unrecognized sign-up" for long-standing accounts.

CREATE OR REPLACE FUNCTION public.list_orphan_signup_candidates(
  p_min_age_minutes integer DEFAULT 10,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.email, u.full_name, u.created_at
  FROM public.users u
  WHERE COALESCE(u.is_platform_admin, false) = false
    -- Wait a few minutes so roster linking can finish after sign-up.
    AND u.created_at < now() - make_interval(mins => GREATEST(COALESCE(p_min_age_minutes, 10), 1))
    -- Only true recent sign-ups. Older accounts with no membership are usually
    -- leftover after an event was deleted / never invited — not a new signup spike.
    AND u.created_at >= now() - interval '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.event_members em WHERE em.user_id = u.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.platform_security_alert_sent s
      WHERE s.user_id = u.id
        AND s.alert_type = 'orphan_signup'
    )
  ORDER BY u.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.list_orphan_signup_candidates(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_orphan_signup_candidates(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.notify_platform_admins_orphan_signup(
  p_user_id UUID,
  p_email TEXT,
  p_full_name TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_ids UUID[];
  uid UUID;
  v_created TIMESTAMPTZ;
  v_is_fresh BOOLEAN;
  title_text TEXT;
  body_text TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_members em WHERE em.user_id = p_user_id) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND COALESCE(u.is_platform_admin, false) = true
  ) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.platform_security_alert_sent s
    WHERE s.user_id = p_user_id AND s.alert_type = 'orphan_signup'
  ) THEN
    RETURN;
  END IF;

  SELECT u.created_at INTO v_created
  FROM public.users u
  WHERE u.id = p_user_id;

  -- Skip accounts older than the alert window (e.g. after event deletion).
  IF v_created IS NULL OR v_created < now() - interval '7 days' THEN
    RETURN;
  END IF;

  v_is_fresh := v_created >= now() - interval '48 hours';

  title_text := CASE
    WHEN v_is_fresh THEN 'New account with no event membership'
    ELSE 'Recent account with no event membership'
  END;

  body_text := format(
    CASE
      WHEN v_is_fresh THEN
        '%s (%s) created a KBM account and is not on any event roster yet. Account created: %s. Review in cadmin → Security audit.'
      ELSE
        '%s (%s) has a recent KBM account with no event membership. This can mean they never joined an event, or membership was removed (for example after an event was deleted). Account created: %s. Review in cadmin → Security audit.'
    END,
    COALESCE(NULLIF(trim(p_full_name), ''), 'Unknown'),
    COALESCE(NULLIF(trim(p_email), ''), 'no email'),
    coalesce(v_created::text, 'unknown')
  );

  SELECT COALESCE(array_agg(u.id), ARRAY[]::uuid[])
  INTO admin_ids
  FROM public.users u
  WHERE COALESCE(u.is_platform_admin, false) = true;

  IF admin_ids IS NOT NULL THEN
    FOREACH uid IN ARRAY admin_ids
    LOOP
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        uid,
        'security_alert',
        title_text,
        body_text,
        jsonb_build_object(
          'alert_type', 'orphan_signup',
          'user_id', p_user_id,
          'email', p_email,
          'account_created_at', v_created,
          'fresh_signup', v_is_fresh
        )
      );
    END LOOP;
  END IF;

  INSERT INTO public.platform_security_alert_sent (user_id, alert_type)
  VALUES (p_user_id, 'orphan_signup')
  ON CONFLICT DO NOTHING;

  PERFORM public.insert_platform_audit_log(
    'security',
    'orphan_signup_alert',
    NULL,
    p_user_id,
    p_email,
    p_full_name,
    NULL,
    NULL,
    jsonb_build_object(
      'source', 'orphan_signup_processor',
      'account_created_at', v_created,
      'fresh_signup', v_is_fresh
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_platform_admins_orphan_signup(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_platform_admins_orphan_signup(UUID, TEXT, TEXT)
  TO service_role;
