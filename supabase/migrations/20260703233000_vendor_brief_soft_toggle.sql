-- Soften the vendor_brief_enabled toggle for the brief RPC: when OFF, still return the
-- attendee profile (so vendors can open the card and add notes), but suppress the prior
-- meetings/notes history. The flags RPC already returns nothing when off (hides chips).

CREATE OR REPLACE FUNCTION public.get_vendor_attendee_brief (
  p_event_id uuid,
  p_subject_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_allowed boolean;
  v_enabled boolean;
  v_brief jsonb;
  v_meetings jsonb := '[]'::jsonb;
  v_notes jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  IF p_event_id IS NULL OR p_subject_user_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_request'); END IF;

  v_enabled := COALESCE((SELECT vendor_brief_enabled FROM public.events WHERE id = p_event_id), true);

  v_is_admin := public.is_event_admin(p_event_id) OR public.is_platform_admin(v_caller);

  SELECT v_is_admin OR EXISTS (
    SELECT 1
    FROM public.meeting_bookings mb
    INNER JOIN public.meeting_slots ms ON ms.id = mb.slot_id
    INNER JOIN public.vendor_booths vb ON vb.id = ms.booth_id
    WHERE vb.event_id = p_event_id
      AND mb.attendee_id = p_subject_user_id
      AND mb.status::text IN ('confirmed', 'requested')
      AND (
        vb.contact_user_id = v_caller
        OR EXISTS (SELECT 1 FROM public.vendor_booth_reps r WHERE r.booth_id = vb.id AND r.user_id = v_caller)
      )
  ) INTO v_allowed;

  IF NOT coalesce(v_allowed, false) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT jsonb_build_object(
    'user_id', u.id,
    'full_name', coalesce(u.full_name, ''),
    'title', u.title,
    'company', u.company,
    'bio', u.bio,
    'linkedin_url', u.linkedin_url,
    'avatar_url', u.avatar_url
  ) INTO v_brief
  FROM public.users u
  WHERE u.id = p_subject_user_id;

  IF v_brief IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  -- Prior interactions only when the feature is enabled for this event.
  IF v_enabled THEN
    WITH my_booths AS (
      SELECT vb.id, lower(trim(vb.vendor_name)) AS vname
      FROM public.vendor_booths vb
      WHERE vb.event_id = p_event_id AND vb.is_active = true
        AND (
          v_is_admin
          OR vb.contact_user_id = v_caller
          OR EXISTS (SELECT 1 FROM public.vendor_booth_reps r WHERE r.booth_id = vb.id AND r.user_id = v_caller)
        )
    ),
    my_names AS (SELECT DISTINCT vname FROM my_booths WHERE vname <> ''),
    my_rep_ids AS (
      SELECT contact_user_id AS uid FROM public.vendor_booths WHERE id IN (SELECT id FROM my_booths) AND contact_user_id IS NOT NULL
      UNION
      SELECT user_id AS uid FROM public.vendor_booth_reps WHERE booth_id IN (SELECT id FROM my_booths)
    ),
    company_booths AS (
      SELECT vb.id, vb.event_id, vb.vendor_name
      FROM public.vendor_booths vb
      WHERE lower(trim(vb.vendor_name)) IN (SELECT vname FROM my_names)
         OR vb.contact_user_id IN (SELECT uid FROM my_rep_ids)
         OR EXISTS (SELECT 1 FROM public.vendor_booth_reps r WHERE r.booth_id = vb.id AND r.user_id IN (SELECT uid FROM my_rep_ids))
    )
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event_id', e.id,
          'event_name', e.name,
          'event_end_date', e.end_date,
          'start_time', ms.start_time,
          'end_time', ms.end_time,
          'vendor_name', cb.vendor_name
        )
        ORDER BY ms.start_time DESC
      ),
      '[]'::jsonb
    ) INTO v_meetings
    FROM public.meeting_bookings mb
    INNER JOIN public.meeting_slots ms ON ms.id = mb.slot_id
    INNER JOIN company_booths cb ON cb.id = ms.booth_id
    INNER JOIN public.events e ON e.id = cb.event_id
    WHERE cb.event_id <> p_event_id
      AND mb.attendee_id = p_subject_user_id
      AND mb.status::text IN ('confirmed', 'requested');

    WITH my_booths AS (
      SELECT vb.id, lower(trim(vb.vendor_name)) AS vname
      FROM public.vendor_booths vb
      WHERE vb.event_id = p_event_id AND vb.is_active = true
        AND (
          v_is_admin
          OR vb.contact_user_id = v_caller
          OR EXISTS (SELECT 1 FROM public.vendor_booth_reps r WHERE r.booth_id = vb.id AND r.user_id = v_caller)
        )
    ),
    my_names AS (SELECT DISTINCT vname FROM my_booths WHERE vname <> ''),
    my_rep_ids AS (
      SELECT contact_user_id AS uid FROM public.vendor_booths WHERE id IN (SELECT id FROM my_booths) AND contact_user_id IS NOT NULL
      UNION
      SELECT user_id AS uid FROM public.vendor_booth_reps WHERE booth_id IN (SELECT id FROM my_booths)
    ),
    company_booths AS (
      SELECT vb.id
      FROM public.vendor_booths vb
      WHERE lower(trim(vb.vendor_name)) IN (SELECT vname FROM my_names)
         OR vb.contact_user_id IN (SELECT uid FROM my_rep_ids)
         OR EXISTS (SELECT 1 FROM public.vendor_booth_reps r WHERE r.booth_id = vb.id AND r.user_id IN (SELECT uid FROM my_rep_ids))
    ),
    company_rep_ids AS (
      SELECT contact_user_id AS uid FROM public.vendor_booths WHERE id IN (SELECT id FROM company_booths) AND contact_user_id IS NOT NULL
      UNION
      SELECT user_id AS uid FROM public.vendor_booth_reps WHERE booth_id IN (SELECT id FROM company_booths)
    )
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event_id', e.id,
          'event_name', e.name,
          'event_end_date', e.end_date,
          'created_at', coalesce(bs.updated_at, bs.created_at),
          'scanner_name', coalesce(su.full_name, 'A teammate'),
          'note', coalesce(bs.note, ''),
          'attended_meeting', bs.attended_meeting
        )
        ORDER BY coalesce(bs.updated_at, bs.created_at) DESC
      ),
      '[]'::jsonb
    ) INTO v_notes
    FROM public.badge_scans bs
    INNER JOIN public.events e ON e.id = bs.event_id
    LEFT JOIN public.users su ON su.id = bs.scanner_user_id
    WHERE bs.event_id <> p_event_id
      AND bs.subject_user_id = p_subject_user_id
      AND bs.scanner_user_id IN (SELECT uid FROM company_rep_ids)
      AND (coalesce(trim(bs.note), '') <> '' OR bs.attended_meeting = true);
  END IF;

  RETURN jsonb_build_object(
    'brief', v_brief,
    'prior_meetings', v_meetings,
    'prior_notes', v_notes,
    'met_before', (jsonb_array_length(v_meetings) > 0 OR jsonb_array_length(v_notes) > 0),
    'prior_enabled', v_enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_vendor_attendee_brief (uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vendor_attendee_brief (uuid, uuid) TO authenticated;
