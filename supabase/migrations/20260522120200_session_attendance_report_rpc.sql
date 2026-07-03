CREATE OR REPLACE FUNCTION public.get_session_attendance_report(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  sess RECORD;
  rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  SELECT s.id, s.event_id, s.title, s.description, s.start_time, s.end_time, s.location, s.room, s.day_number
  INTO sess
  FROM public.schedule_sessions s
  WHERE s.id = p_session_id;
  IF sess.id IS NULL THEN
    RETURN jsonb_build_object('error', 'session_not_found');
  END IF;
  v_event_id := sess.event_id;
  IF NOT (public.is_event_admin(v_event_id) OR public.is_platform_admin(auth.uid())) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'sort_key'), '[]'::jsonb) INTO rows
  FROM (
    SELECT jsonb_build_object(
      'user_id', u.id,
      'full_name', COALESCE(u.full_name, ''),
      'email', COALESCE(u.email, ''),
      'company', COALESCE(u.company, ''),
      'bookmarked', true,
      'checked_in', (sci.id IS NOT NULL),
      'checked_in_at', sci.checked_in_at,
      'checked_in_by_name', scanner_u.full_name,
      'sort_key', lower(COALESCE(u.full_name, u.email, ''))
    ) AS row
    FROM public.user_schedule us
    JOIN public.users u ON u.id = us.user_id
    LEFT JOIN public.session_check_ins sci
      ON sci.session_id = p_session_id AND sci.subject_user_id = u.id
    LEFT JOIN public.users scanner_u ON scanner_u.id = sci.checked_in_by_user_id
    WHERE us.session_id = p_session_id

    UNION ALL

    SELECT jsonb_build_object(
      'user_id', u.id,
      'full_name', COALESCE(u.full_name, ''),
      'email', COALESCE(u.email, ''),
      'company', COALESCE(u.company, ''),
      'bookmarked', false,
      'checked_in', true,
      'checked_in_at', sci.checked_in_at,
      'checked_in_by_name', scanner_u.full_name,
      'sort_key', lower(COALESCE(u.full_name, u.email, ''))
    ) AS row
    FROM public.session_check_ins sci
    JOIN public.users u ON u.id = sci.subject_user_id
    LEFT JOIN public.users scanner_u ON scanner_u.id = sci.checked_in_by_user_id
    WHERE sci.session_id = p_session_id
      AND NOT EXISTS (
        SELECT 1 FROM public.user_schedule us2
        WHERE us2.session_id = p_session_id AND us2.user_id = sci.subject_user_id
      )
  ) q;

  RETURN jsonb_build_object(
    'session', jsonb_build_object(
      'id', sess.id,
      'event_id', sess.event_id,
      'title', sess.title,
      'description', sess.description,
      'start_time', sess.start_time,
      'end_time', sess.end_time,
      'location', sess.location,
      'room', sess.room,
      'day_number', sess.day_number
    ),
    'rows', COALESCE(rows, '[]'::jsonb),
    'stats', jsonb_build_object(
      'checked_in_count', (
        SELECT COUNT(*)::int FROM public.session_check_ins WHERE session_id = p_session_id
      ),
      'bookmarked_count', (
        SELECT COUNT(*)::int FROM public.user_schedule WHERE session_id = p_session_id
      ),
      'bookmarked_checked_in', (
        SELECT COUNT(*)::int
        FROM public.user_schedule us
        JOIN public.session_check_ins sci
          ON sci.session_id = us.session_id AND sci.subject_user_id = us.user_id
        WHERE us.session_id = p_session_id
      ),
      'bookmarked_no_show', (
        SELECT COUNT(*)::int
        FROM public.user_schedule us
        WHERE us.session_id = p_session_id
          AND NOT EXISTS (
            SELECT 1 FROM public.session_check_ins sci
            WHERE sci.session_id = p_session_id AND sci.subject_user_id = us.user_id
          )
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_session_attendance_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_attendance_report(uuid) TO authenticated;
