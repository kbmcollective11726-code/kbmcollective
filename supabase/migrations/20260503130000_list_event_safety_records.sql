-- Event admins / platform admins: reports and blocks where both users are members of the event.

CREATE OR REPLACE FUNCTION public.list_event_safety_records (p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reports jsonb := '[]'::jsonb;
  v_blocks jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  IF NOT (public.is_event_admin(p_event_id) OR public.is_platform_admin(auth.uid())) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_reports
  FROM (
    SELECT jsonb_build_object(
      'id', ur.id,
      'reason', ur.reason,
      'details', ur.details,
      'created_at', ur.created_at,
      'reporter', jsonb_build_object(
        'user_id', ru.id,
        'full_name', coalesce(ru.full_name, ''),
        'email', coalesce(ru.email, '')
      ),
      'reported', jsonb_build_object(
        'user_id', uu.id,
        'full_name', coalesce(uu.full_name, ''),
        'email', coalesce(uu.email, '')
      )
    ) AS x,
    ur.created_at AS ord
    FROM public.user_reports ur
    INNER JOIN public.users ru ON ru.id = ur.reporter_id
    INNER JOIN public.users uu ON uu.id = ur.reported_user_id
    WHERE EXISTS (
      SELECT 1 FROM public.event_members em1
      WHERE em1.event_id = p_event_id AND em1.user_id = ur.reporter_id
    )
    AND EXISTS (
      SELECT 1 FROM public.event_members em2
      WHERE em2.event_id = p_event_id AND em2.user_id = ur.reported_user_id
    )
  ) q;

  SELECT coalesce(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_blocks
  FROM (
    SELECT jsonb_build_object(
      'id', bu.id,
      'created_at', bu.created_at,
      'blocker', jsonb_build_object(
        'user_id', bku.id,
        'full_name', coalesce(bku.full_name, ''),
        'email', coalesce(bku.email, '')
      ),
      'blocked', jsonb_build_object(
        'user_id', ubd.id,
        'full_name', coalesce(ubd.full_name, ''),
        'email', coalesce(ubd.email, '')
      )
    ) AS x,
    bu.created_at AS ord
    FROM public.blocked_users bu
    INNER JOIN public.users bku ON bku.id = bu.blocker_id
    INNER JOIN public.users ubd ON ubd.id = bu.blocked_user_id
    WHERE EXISTS (
      SELECT 1 FROM public.event_members em1
      WHERE em1.event_id = p_event_id AND em1.user_id = bu.blocker_id
    )
    AND EXISTS (
      SELECT 1 FROM public.event_members em2
      WHERE em2.event_id = p_event_id AND em2.user_id = bu.blocked_user_id
    )
  ) q2;

  RETURN jsonb_build_object('reports', v_reports, 'blocks', v_blocks);
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_safety_records (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_event_safety_records (uuid) TO authenticated;
