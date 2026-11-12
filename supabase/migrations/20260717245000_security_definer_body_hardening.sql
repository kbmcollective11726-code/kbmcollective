-- Body-level authorization fixes found while auditing callable definer RPCs.

CREATE OR REPLACE FUNCTION public.is_member_of_chat_group(
  p_group_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND (
      p_user_id = auth.uid()
      OR public.is_platform_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.chat_groups g
        WHERE g.id = p_group_id
          AND public.is_event_admin(g.event_id)
      )
    )
    AND EXISTS (
      SELECT 1
      FROM public.chat_group_members
      WHERE group_id = p_group_id
        AND user_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.list_vendor_attendee_badge_tokens(
  p_event_id uuid,
  p_subject_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  IF p_event_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_event'); END IF;
  IF p_subject_ids IS NULL OR cardinality(p_subject_ids) = 0 THEN
    RETURN jsonb_build_object('error', 'subject_ids_required');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vendor_booths vb
    WHERE vb.event_id = p_event_id
      AND vb.is_active = true
      AND (
        vb.contact_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.vendor_booth_reps vbr
          WHERE vbr.booth_id = vb.id AND vbr.user_id = auth.uid()
        )
      )
  ) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('user_id', t.user_id, 'token', t.token)),
    '[]'::jsonb
  )
  INTO rows
  FROM public.event_badge_tokens t
  WHERE t.event_id = p_event_id
    AND t.user_id = ANY(p_subject_ids)
    AND EXISTS (
      SELECT 1
      FROM public.meeting_bookings mb
      JOIN public.meeting_slots ms ON ms.id = mb.slot_id
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      WHERE mb.attendee_id = t.user_id
        AND mb.status::text IN ('confirmed', 'requested')
        AND vb.event_id = p_event_id
        AND (
          vb.contact_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.vendor_booth_reps vbr
            WHERE vbr.booth_id = vb.id AND vbr.user_id = auth.uid()
          )
        )
    );
  RETURN jsonb_build_object('rows', rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_meeting_request_targets(
  p_event_id uuid,
  p_submission_id uuid
)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  company_name text,
  job_title text,
  attendee_type text,
  logo_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH source AS (
    SELECT public.assert_meeting_request_caller(p_submission_id) AS s
  )
  SELECT
    cand.id,
    cand.first_name,
    cand.last_name,
    cand.company_name,
    cand.job_title,
    cand.attendee_type,
    (
      SELECT a.answer_text
      FROM public.event_registration_answers a
      JOIN public.event_registration_questions q ON q.id = a.question_id
      WHERE a.submission_id = cand.id
        AND lower(trim(q.prompt)) IN ('company logo image', 'company logo url')
      ORDER BY a.updated_at DESC
      LIMIT 1
    )
  FROM public.event_registration_submissions cand
  CROSS JOIN source src
  WHERE (src.s).event_id = p_event_id
    AND cand.event_id = p_event_id
    AND cand.id <> p_submission_id
    AND cand.status = 'submitted'
    AND cand.registration_status = 'approved'
    AND cand.profile_complete = true
    AND cand.attendee_type = CASE
      WHEN (src.s).attendee_type = 'vendor' THEN 'attendee'
      ELSE 'vendor'
    END
  ORDER BY cand.company_name NULLS LAST, cand.last_name NULLS LAST, cand.first_name NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.get_meeting_request_target_profile(
  p_event_id uuid,
  p_submission_id uuid,
  p_target_submission_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.event_registration_submissions;
  v_target public.event_registration_submissions;
  v_answers jsonb;
  v_categories jsonb;
BEGIN
  v_source := public.assert_meeting_request_caller(p_submission_id);
  IF v_source.event_id IS DISTINCT FROM p_event_id THEN
    RAISE EXCEPTION 'Source submission is not part of this event'
      USING ERRCODE = '42501';
  END IF;

  SELECT s.* INTO v_target
  FROM public.event_registration_submissions s
  WHERE s.id = p_target_submission_id
    AND s.event_id = p_event_id
    AND s.status = 'submitted'
    AND s.registration_status = 'approved'
    AND s.profile_complete = true
    AND s.attendee_type = CASE
      WHEN v_source.attendee_type = 'vendor' THEN 'attendee'
      ELSE 'vendor'
    END
  LIMIT 1;
  IF v_target.id IS NULL THEN RAISE EXCEPTION 'Target profile not available'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'prompt', q.prompt,
    'section_label', q.section_label,
    'value', coalesce(
      CASE
        WHEN a.answer_json IS NOT NULL AND jsonb_typeof(a.answer_json) = 'array'
          THEN (SELECT string_agg(elem, ', ' ORDER BY ord)
                FROM jsonb_array_elements_text(a.answer_json)
                WITH ORDINALITY AS t(elem, ord))
        WHEN a.answer_json IS NOT NULL THEN a.answer_json #>> '{}'
        WHEN a.answer_boolean IS NOT NULL THEN CASE WHEN a.answer_boolean THEN 'Yes' ELSE 'No' END
        WHEN a.answer_number IS NOT NULL THEN a.answer_number::text
        ELSE a.answer_text
      END,
      ''
    )
  ) ORDER BY q.sort_order, q.created_at), '[]'::jsonb)
  INTO v_answers
  FROM public.event_registration_answers a
  JOIN public.event_registration_questions q ON q.id = a.question_id
  WHERE a.submission_id = v_target.id
    AND lower(trim(q.prompt)) NOT IN (
      'first name', 'last name', 'email', 'e-mail address',
      'company name', 'job title', 'cell phone', 'password'
    );

  SELECT coalesce(
    jsonb_agg(c.category_name ORDER BY c.display_order, c.category_name),
    '[]'::jsonb
  )
  INTO v_categories
  FROM public.event_registration_solution_categories sc
  JOIN public.event_solution_categories c ON c.id = sc.category_id
  WHERE sc.submission_id = v_target.id;

  RETURN jsonb_build_object(
    'id', v_target.id,
    'first_name', v_target.first_name,
    'last_name', v_target.last_name,
    'company_name', v_target.company_name,
    'job_title', v_target.job_title,
    'attendee_type', v_target.attendee_type,
    'answers', v_answers,
    'categories', v_categories
  );
END;
$$;

-- Preserve the existing scan implementation behind a validating wrapper.
ALTER FUNCTION public.upsert_badge_scan(text, text, boolean, uuid)
  RENAME TO upsert_badge_scan_internal_202607;
REVOKE ALL ON FUNCTION public.upsert_badge_scan_internal_202607(text, text, boolean, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.upsert_badge_scan(
  p_token text,
  p_note text,
  p_attended_meeting boolean,
  p_meeting_booking_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_booth_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  IF p_meeting_booking_id IS NOT NULL THEN
    SELECT vb.event_id, vb.id INTO v_event_id, v_booth_id
    FROM public.meeting_bookings mb
    JOIN public.meeting_slots ms ON ms.id = mb.slot_id
    JOIN public.vendor_booths vb ON vb.id = ms.booth_id
    JOIN public.event_badge_tokens t
      ON t.event_id = vb.event_id
     AND t.user_id = mb.attendee_id
     AND t.token = trim(p_token)
    WHERE mb.id = p_meeting_booking_id
      AND mb.status::text IN ('confirmed', 'requested');
    IF v_event_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_meeting'); END IF;
    IF NOT (
      public.is_platform_admin(auth.uid())
      OR public.is_event_admin(v_event_id)
      OR EXISTS (
        SELECT 1 FROM public.vendor_booths vb
        WHERE vb.id = v_booth_id AND vb.contact_user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.vendor_booth_reps vbr
        WHERE vbr.booth_id = v_booth_id AND vbr.user_id = auth.uid()
      )
    ) THEN RETURN jsonb_build_object('error', 'forbidden_meeting'); END IF;
  END IF;
  RETURN public.upsert_badge_scan_internal_202607(
    p_token, p_note, p_attended_meeting, p_meeting_booking_id
  );
END;
$$;

ALTER FUNCTION public.list_badge_scan_meeting_options(text)
  RENAME TO list_badge_scan_meeting_options_internal_202607;
REVOKE ALL ON FUNCTION public.list_badge_scan_meeting_options_internal_202607(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.list_badge_scan_meeting_options(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  SELECT event_id INTO v_event_id
  FROM public.event_badge_tokens
  WHERE token = trim(p_token);
  IF v_event_id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF NOT (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(v_event_id)
    OR EXISTS (
      SELECT 1
      FROM public.vendor_booths vb
      WHERE vb.event_id = v_event_id
        AND (
          vb.contact_user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.vendor_booth_reps vbr
            WHERE vbr.booth_id = vb.id AND vbr.user_id = auth.uid()
          )
        )
    )
  ) THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  RETURN public.list_badge_scan_meeting_options_internal_202607(p_token);
END;
$$;

-- Public apps call the wrappers only.
REVOKE ALL ON FUNCTION public.list_vendor_attendee_badge_tokens(uuid, uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_vendor_attendee_badge_tokens(uuid, uuid[])
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_meeting_request_targets(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_meeting_request_targets(uuid, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_meeting_request_target_profile(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meeting_request_target_profile(uuid, uuid, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_badge_scan(text, text, boolean, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_badge_scan(text, text, boolean, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_badge_scan_meeting_options(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_badge_scan_meeting_options(text)
  TO authenticated, service_role;

-- Internal helpers are only reachable through validated outer functions.
REVOKE ALL ON FUNCTION public.assert_meeting_request_caller(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_meeting_request_caller(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.submission_answer_text(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submission_answer_text(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.compute_match_score(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_match_score(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.user_failed_logins_7d(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_failed_logins_7d(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.user_has_submitted_portal_registration(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_submitted_portal_registration(uuid, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.add_creator_as_event_admin()
  FROM PUBLIC, anon, authenticated, service_role;
