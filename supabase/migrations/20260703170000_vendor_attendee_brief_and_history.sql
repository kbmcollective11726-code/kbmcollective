-- Vendor "have we met before?" + pre-meeting attendee brief.
--
-- Two SECURITY DEFINER RPCs, both restricted to the vendor reps/contact of a booth at the
-- current event (or event/platform admins). A vendor only ever sees data for attendees they
-- actually have a (confirmed/requested) meeting with at the current event.
--
-- "Same company" is matched COMPANY-WIDE across events, not just for the calling rep:
--   a booth (in any event) counts as the same vendor when its normalized vendor_name matches
--   one of the caller's current booths, OR it shares a rep/contact user with them.
-- Prior meetings and prior badge-scan notes from ANY of the company's reps are surfaced.

-- ---------------------------------------------------------------------------
-- Helper view-less CTE logic is duplicated in both functions on purpose (functions are the API
-- boundary and each re-derives the caller's company scope from auth.uid()).
-- ---------------------------------------------------------------------------

-- 1) At-a-glance flags for a set of attendees the vendor is meeting at this event.
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

  -- Caller must be a rep/contact of a booth at this event (admins allowed too).
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
  -- Attendees the caller actually meets at THIS event (bounds what we may reveal).
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

-- 2) Full pre-meeting brief + prior history for one attendee.
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

  v_is_admin := public.is_event_admin(p_event_id) OR public.is_platform_admin(v_caller);

  -- Caller must be admin, OR a rep/contact of a current-event booth that has a booking with this attendee.
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
