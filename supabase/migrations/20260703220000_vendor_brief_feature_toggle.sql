-- Per-event toggle for the vendor "pre-meeting brief + have we met before" feature.
-- Default ON. When false, both vendor-brief RPCs return no data (feature hidden in-app).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS vendor_brief_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.vendor_brief_enabled IS
  'When true (default), vendors/admins see the pre-meeting attendee brief and "have we met before" history. Event admins can turn it off per event.';

-- Recreate both RPCs with an early exit when the feature is disabled for the event.

CREATE OR REPLACE FUNCTION public.list_vendor_prior_interaction_flags (
  p_event_id uuid,
  p_subject_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  IF p_event_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_event'); END IF;

  -- Feature toggle: when off for this event, surface nothing.
  IF NOT COALESCE((SELECT vendor_brief_enabled FROM public.events WHERE id = p_event_id), true) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb);
  END IF;

  IF NOT (
    public.is_event_admin(p_event_id)
    OR public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.vendor_booths vb
      WHERE vb.event_id = p_event_id AND vb.is_active = true
        AND (
          vb.contact_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.vendor_booth_reps r WHERE r.booth_id = vb.id AND r.user_id = auth.uid())
        )
    )
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  WITH my_booths AS (
    SELECT vb.id, lower(trim(vb.vendor_name)) AS vname
    FROM public.vendor_booths vb
    WHERE vb.event_id = p_event_id AND vb.is_active = true
      AND (
        vb.contact_user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.vendor_booth_reps r WHERE r.booth_id = vb.id AND r.user_id = auth.uid())
      )
  ),
  my_names AS (SELECT DISTINCT vname FROM my_booths WHERE vname <> ''),
  my_rep_ids AS (
    SELECT contact_user_id AS uid FROM public.vendor_booths WHERE id IN (SELECT id FROM my_booths) AND contact_user_id IS NOT NULL
    UNION
    SELECT user_id AS uid FROM public.vendor_booth_reps WHERE booth_id IN (SELECT id FROM my_booths)
  ),
  company_booths AS (
    SELECT vb.id, vb.event_id
    FROM public.vendor_booths vb
    WHERE lower(trim(vb.vendor_name)) IN (SELECT vname FROM my_names)
       OR vb.contact_user_id IN (SELECT uid FROM my_rep_ids)
       OR EXISTS (SELECT 1 FROM public.vendor_booth_reps r WHERE r.booth_id = vb.id AND r.user_id IN (SELECT uid FROM my_rep_ids))
  ),
  company_rep_ids AS (
    SELECT contact_user_id AS uid FROM public.vendor_booths WHERE id IN (SELECT id FROM company_booths) AND contact_user_id IS NOT NULL
    UNION
    SELECT user_id AS uid FROM public.vendor_booth_reps WHERE booth_id IN (SELECT id FROM company_booths)
  ),
  my_attendees AS (
    SELECT DISTINCT mb.attendee_id
    FROM public.meeting_bookings mb
    INNER JOIN public.meeting_slots ms ON ms.id = mb.slot_id
    WHERE ms.booth_id IN (SELECT id FROM my_booths)
      AND mb.status::text IN ('confirmed', 'requested')
      AND (p_subject_ids IS NULL OR cardinality(p_subject_ids) = 0 OR mb.attendee_id = ANY(p_subject_ids))
  ),
  prior_meetings AS (
    SELECT mb.attendee_id AS subject_user_id, e.name AS event_name, e.end_date AS event_date, ms.start_time AS ts
    FROM public.meeting_bookings mb
    INNER JOIN public.meeting_slots ms ON ms.id = mb.slot_id
    INNER JOIN company_booths cb ON cb.id = ms.booth_id
    INNER JOIN public.events e ON e.id = cb.event_id
    WHERE cb.event_id <> p_event_id
      AND mb.status::text IN ('confirmed', 'requested')
      AND mb.attendee_id IN (SELECT attendee_id FROM my_attendees)
  ),
  prior_notes AS (
    SELECT bs.subject_user_id, e.name AS event_name, coalesce(bs.updated_at, bs.created_at) AS ts
    FROM public.badge_scans bs
    INNER JOIN public.events e ON e.id = bs.event_id
    WHERE bs.event_id <> p_event_id
      AND bs.scanner_user_id IN (SELECT uid FROM company_rep_ids)
      AND bs.subject_user_id IN (SELECT attendee_id FROM my_attendees)
      AND (coalesce(trim(bs.note), '') <> '' OR bs.attended_meeting = true)
  ),
  combined AS (
    SELECT subject_user_id, event_name, event_date::timestamptz AS ts, 1 AS is_meeting, 0 AS is_note FROM prior_meetings
    UNION ALL
    SELECT subject_user_id, event_name, ts, 0 AS is_meeting, 1 AS is_note FROM prior_notes
  ),
  agg AS (
    SELECT
      subject_user_id,
      sum(is_meeting) AS prior_meetings_count,
      sum(is_note) AS prior_notes_count,
      (array_agg(event_name ORDER BY ts DESC))[1] AS last_event_name,
      max(ts) AS last_interaction_at
    FROM combined
    GROUP BY subject_user_id
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'subject_user_id', a.subject_user_id,
        'prior_meetings_count', a.prior_meetings_count,
        'prior_notes_count', a.prior_notes_count,
        'last_event_name', a.last_event_name,
        'last_interaction_at', a.last_interaction_at
      )
    ),
    '[]'::jsonb
  ) INTO rows
  FROM agg a;

  RETURN jsonb_build_object('rows', rows);
END;
$$;

REVOKE ALL ON FUNCTION public.list_vendor_prior_interaction_flags (uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_vendor_prior_interaction_flags (uuid, uuid[]) TO authenticated;

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
  v_brief jsonb;
  v_meetings jsonb := '[]'::jsonb;
  v_notes jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  IF p_event_id IS NULL OR p_subject_user_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_request'); END IF;

  -- Feature toggle: when off for this event, the brief is unavailable.
  IF NOT COALESCE((SELECT vendor_brief_enabled FROM public.events WHERE id = p_event_id), true) THEN
    RETURN jsonb_build_object('error', 'disabled');
  END IF;

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

  RETURN jsonb_build_object(
    'brief', v_brief,
    'prior_meetings', v_meetings,
    'prior_notes', v_notes,
    'met_before', (jsonb_array_length(v_meetings) > 0 OR jsonb_array_length(v_notes) > 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_vendor_attendee_brief (uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vendor_attendee_brief (uuid, uuid) TO authenticated;
