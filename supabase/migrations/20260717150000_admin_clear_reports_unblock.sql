-- Platform / event admins can clear test or mistaken reports and remove attendee blocks.

CREATE OR REPLACE FUNCTION public.admin_clear_user_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_reported uuid;
  v_reporter uuid;
  v_reason text;
  v_allowed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT ur.event_id, ur.reported_user_id, ur.reporter_id, ur.reason
  INTO v_event_id, v_reported, v_reporter, v_reason
  FROM public.user_reports ur
  WHERE ur.id = p_report_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF public.is_platform_admin(v_uid) THEN
    v_allowed := true;
  ELSIF v_event_id IS NOT NULL AND public.is_event_admin(v_event_id) THEN
    v_allowed := true;
  ELSIF EXISTS (
    SELECT 1
    FROM public.event_members em1
    INNER JOIN public.event_members em2
      ON em2.event_id = em1.event_id
     AND em2.user_id = v_reported
    WHERE em1.user_id = v_reporter
      AND public.is_event_admin(em1.event_id)
  ) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  DELETE FROM public.user_reports WHERE id = p_report_id;

  RETURN jsonb_build_object(
    'ok', true,
    'report_id', p_report_id,
    'reported_user_id', v_reported,
    'reporter_id', v_reporter,
    'reason', coalesce(v_reason, ''),
    'event_id', v_event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_clear_user_reports(p_report_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_cleared int := 0;
  v_failed int := 0;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_report_ids IS NULL OR cardinality(p_report_ids) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_ids');
  END IF;

  FOREACH v_id IN ARRAY p_report_ids LOOP
    v_result := public.admin_clear_user_report(v_id);
    IF coalesce((v_result->>'ok')::boolean, false) THEN
      v_cleared := v_cleared + 1;
    ELSE
      v_failed := v_failed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cleared', v_cleared, 'failed', v_failed);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_user_block(p_block_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_blocker uuid;
  v_blocked uuid;
  v_allowed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT bu.blocker_id, bu.blocked_user_id
  INTO v_blocker, v_blocked
  FROM public.blocked_users bu
  WHERE bu.id = p_block_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF public.is_platform_admin(v_uid) THEN
    v_allowed := true;
  ELSIF EXISTS (
    SELECT 1
    FROM public.event_members em1
    INNER JOIN public.event_members em2
      ON em2.event_id = em1.event_id
     AND em2.user_id = v_blocked
    WHERE em1.user_id = v_blocker
      AND public.is_event_admin(em1.event_id)
  ) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  DELETE FROM public.blocked_users WHERE id = p_block_id;

  RETURN jsonb_build_object(
    'ok', true,
    'block_id', p_block_id,
    'blocker_id', v_blocker,
    'blocked_user_id', v_blocked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_clear_user_report(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_clear_user_reports(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remove_user_block(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_user_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clear_user_reports(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_user_block(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_clear_user_report(uuid) IS
  'Platform or event admin: permanently remove a user report (e.g. test reports).';
COMMENT ON FUNCTION public.admin_clear_user_reports(uuid[]) IS
  'Platform or event admin: clear multiple user reports.';
COMMENT ON FUNCTION public.admin_remove_user_block(uuid) IS
  'Platform or event admin: remove a block so the two users can interact again.';
