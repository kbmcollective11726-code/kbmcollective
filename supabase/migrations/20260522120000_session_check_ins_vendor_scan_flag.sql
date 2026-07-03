-- Session room check-in (event admins) + hide vendor meeting attendance UI by default.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS vendor_scan_show_meeting_checkin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.vendor_scan_show_meeting_checkin IS
  'When true, vendors see 1:1 / unscheduled meeting check-in toggles on badge scan. Default false.';

CREATE TABLE IF NOT EXISTS public.session_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.schedule_sessions(id) ON DELETE CASCADE,
  subject_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  checked_in_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_check_ins_session_subject UNIQUE (session_id, subject_user_id)
);

CREATE INDEX IF NOT EXISTS idx_session_check_ins_session ON public.session_check_ins(session_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_check_ins_event ON public.session_check_ins(event_id);

ALTER TABLE public.session_check_ins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Session check-ins event admin read" ON public.session_check_ins;
CREATE POLICY "Session check-ins event admin read"
  ON public.session_check_ins FOR SELECT
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

-- Inserts only via RPC.

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
  sub RECORD;
  sess RECORD;
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

  IF NOT public.is_event_admin(v_event_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT t.user_id INTO v_subject
  FROM public.event_badge_tokens t
  WHERE t.event_id = v_event_id AND t.token = trim(p_token);
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

  SELECT sci.checked_in_at INTO v_existing
  FROM public.session_check_ins sci
  WHERE sci.session_id = p_session_id AND sci.subject_user_id = v_subject;

  IF v_existing IS NOT NULL THEN
    SELECT COUNT(*)::int INTO v_count FROM public.session_check_ins WHERE session_id = p_session_id;
    SELECT id, full_name, email, company INTO sub FROM public.users WHERE id = v_subject;
    RETURN jsonb_build_object(
      'ok', true,
      'already_checked_in', true,
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
  END IF;

  INSERT INTO public.session_check_ins (event_id, session_id, subject_user_id, checked_in_by_user_id)
  VALUES (v_event_id, p_session_id, v_subject, v_scanner);

  SELECT COUNT(*)::int INTO v_count FROM public.session_check_ins WHERE session_id = p_session_id;
  SELECT id, full_name, email, company INTO sub FROM public.users WHERE id = v_subject;

  RETURN jsonb_build_object(
    'ok', true,
    'already_checked_in', false,
    'checked_in_at', now(),
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

REVOKE ALL ON FUNCTION public.record_session_check_in(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_session_check_in(uuid, text) TO authenticated;

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
