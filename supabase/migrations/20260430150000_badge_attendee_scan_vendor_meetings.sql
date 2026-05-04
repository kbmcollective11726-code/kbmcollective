-- When an attendee scans a vendor's badge: list 1:1s the *scanner* (attendee) has scheduled
-- with booths represented by the *scanned* person (contact or rep). Read-only context for the app.
CREATE OR REPLACE FUNCTION public.list_badge_scan_attendee_with_vendor_meetings (p_token text) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_subject uuid;
  sr_role text;
  sr_roles text[];
  sub_role text;
  sub_roles text[];
  v_scanner_kind text;
  v_subject_kind text;
  r jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;
  SELECT t.event_id, t.user_id INTO v_event_id, v_subject
  FROM public.event_badge_tokens t
  WHERE t.token = trim(p_token);
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = v_event_id AND em.user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  IF v_subject = auth.uid() THEN
    RETURN jsonb_build_object('error', 'cannot_scan_own_badge');
  END IF;
  SELECT role, roles INTO sr_role, sr_roles FROM public.event_members
  WHERE event_id = v_event_id AND user_id = auth.uid();
  SELECT role, roles INTO sub_role, sub_roles FROM public.event_members
  WHERE event_id = v_event_id AND user_id = v_subject;
  v_scanner_kind := public.map_member_role_to_scanner_kind(COALESCE(sr_role, 'attendee'), COALESCE(sr_roles, ARRAY[]::text[]));
  v_subject_kind := public.map_member_role_to_scanner_kind(COALESCE(sub_role, 'attendee'), COALESCE(sub_roles, ARRAY[]::text[]));
  IF v_scanner_kind IS DISTINCT FROM 'attendee' THEN
    RETURN jsonb_build_object('error', 'not_attendee_scanner');
  END IF;
  IF v_subject_kind IS DISTINCT FROM 'vendor' THEN
    RETURN jsonb_build_object('error', 'not_vendor_subject');
  END IF;
  WITH base AS (
    SELECT mb.id AS id, vb.vendor_name, ms.start_time, ms.end_time
    FROM public.meeting_bookings mb
    INNER JOIN public.meeting_slots ms ON ms.id = mb.slot_id
    INNER JOIN public.vendor_booths vb ON vb.id = ms.booth_id
    WHERE vb.event_id = v_event_id
      AND mb.attendee_id = auth.uid()
      AND mb.status::text IN ('confirmed', 'requested')
      AND (
        vb.contact_user_id = v_subject
        OR EXISTS (
          SELECT 1 FROM public.vendor_booth_reps vbr
          WHERE vbr.booth_id = vb.id AND vbr.user_id = v_subject
        )
      )
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'vendor_name', b.vendor_name,
        'start_time', b.start_time,
        'end_time', b.end_time,
        'label', b.vendor_name || ' · ' || to_char(b.start_time, 'Mon DD, HH12:MI PM')
      )
      ORDER BY b.start_time
    ),
    '[]'::jsonb
  ) INTO r
  FROM base b;
  RETURN jsonb_build_object('rows', r);
END;
$$;

REVOKE ALL ON FUNCTION public.list_badge_scan_attendee_with_vendor_meetings (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_badge_scan_attendee_with_vendor_meetings (text) TO authenticated;
