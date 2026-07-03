-- Atomic check-in: avoid race where parallel scans insert then surface "already scanned" after adding.
CREATE OR REPLACE FUNCTION public.record_session_check_in(p_session_id uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_subject uuid;
  v_scanner uuid := auth.uid();
  v_existing timestamptz;
  v_count int;
  v_inserted boolean := false;
  v_ev RECORD;
  sub RECORD;
  sess RECORD;
  v_new_at timestamptz;
BEGIN
  IF v_scanner IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_session');
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT s.id, s.event_id, s.title, s.start_time, s.end_time, s.location, s.room
  INTO sess
  FROM public.schedule_sessions s
  WHERE s.id = p_session_id AND s.is_active IS NOT DISTINCT FROM true;
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('error', 'session_not_found');
  END IF;
  v_event_id := sess.event_id;

  IF NOT (public.is_event_admin(v_event_id) OR public.is_platform_admin(auth.uid())) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF NOT public.is_platform_admin(auth.uid()) THEN
    SELECT e.admin_console_tiles, e.menu_show_session_check_in, e.platform_menu_show_session_check_in
    INTO v_ev
    FROM public.events e WHERE e.id = v_event_id;
    IF NOT ('session_attendance' = ANY(COALESCE(v_ev.admin_console_tiles, ARRAY[]::text[]))) THEN
      RETURN jsonb_build_object('error', 'feature_disabled');
    END IF;
    IF v_ev.platform_menu_show_session_check_in IS NOT TRUE OR v_ev.menu_show_session_check_in IS FALSE THEN
      RETURN jsonb_build_object('error', 'feature_disabled');
    END IF;
  ELSE
    SELECT e.menu_show_session_check_in, e.platform_menu_show_session_check_in
    INTO v_ev
    FROM public.events e WHERE e.id = v_event_id;
    IF v_ev.platform_menu_show_session_check_in IS NOT TRUE OR v_ev.menu_show_session_check_in IS FALSE THEN
      RETURN jsonb_build_object('error', 'feature_disabled');
    END IF;
  END IF;

  SELECT t.user_id INTO v_subject
  FROM public.event_badge_tokens t
  WHERE t.event_id = v_event_id AND lower(t.token) = lower(trim(p_token));
  IF v_subject IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF v_subject = v_scanner THEN
    RETURN jsonb_build_object('error', 'cannot_scan_own_badge');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = v_event_id AND em.user_id = v_subject
  ) THEN
    RETURN jsonb_build_object('error', 'not_member');
  END IF;

  INSERT INTO public.session_check_ins (event_id, session_id, subject_user_id, checked_in_by_user_id)
  VALUES (v_event_id, p_session_id, v_subject, v_scanner)
  ON CONFLICT (session_id, subject_user_id) DO NOTHING
  RETURNING checked_in_at INTO v_new_at;

  IF v_new_at IS NOT NULL THEN
    v_inserted := true;
    v_existing := v_new_at;
  ELSE
    SELECT sci.checked_in_at INTO v_existing
    FROM public.session_check_ins sci
    WHERE sci.session_id = p_session_id AND sci.subject_user_id = v_subject;
    v_inserted := false;
  END IF;

  IF v_existing IS NULL THEN
    RETURN jsonb_build_object('error', 'check_in_failed');
  END IF;

  SELECT COUNT(*)::int INTO v_count FROM public.session_check_ins WHERE session_id = p_session_id;
  SELECT id, full_name, email, company INTO sub FROM public.users WHERE id = v_subject;

  RETURN jsonb_build_object(
    'ok', true,
    'already_checked_in', NOT v_inserted,
    'checked_in_at', v_existing,
    'check_in_count', v_count,
    'subject', jsonb_build_object(
      'user_id', sub.id,
      'full_name', COALESCE(sub.full_name, ''),
      'email', COALESCE(sub.email, ''),
      'company', COALESCE(sub.company, '')
    ),
    'session', jsonb_build_object(
      'id', sess.id,
      'title', sess.title,
      'start_time', sess.start_time,
      'end_time', sess.end_time
    )
  );
END;
$$;
