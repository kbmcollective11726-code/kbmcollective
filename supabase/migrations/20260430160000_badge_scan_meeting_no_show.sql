-- Allow linking a badge scan to a meeting booking while attended_meeting = false (no-show).
CREATE OR REPLACE FUNCTION public.upsert_badge_scan (p_token text, p_note text, p_attended_meeting boolean, p_meeting_booking_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_subject uuid;
  v_scanner uuid := auth.uid();
  v_kind text;
  r_role text;
  r_roles text[];
  v_mtg uuid;
  v_mtg_subj uuid;
  v_mtg_event uuid;
  v_is_vendor_booth boolean;
BEGIN
  IF v_scanner IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;
  SELECT t.event_id, t.user_id INTO v_event_id, v_subject
  FROM public.event_badge_tokens t WHERE t.token = trim(p_token);
  IF v_event_id IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_subject = v_scanner THEN RETURN jsonb_build_object('error', 'cannot_scan_own_badge'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = v_event_id AND em.user_id = v_scanner) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  SELECT em.role, em.roles INTO r_role, r_roles FROM public.event_members em
  WHERE em.event_id = v_event_id AND em.user_id = v_scanner;
  v_kind := public.map_member_role_to_scanner_kind(COALESCE(r_role, 'attendee'), COALESCE(r_roles, ARRAY[]::text[]));
  v_mtg := NULL;
  IF p_meeting_booking_id IS NOT NULL THEN
    SELECT mb.id, mb.attendee_id, vb.event_id INTO v_mtg, v_mtg_subj, v_mtg_event
    FROM public.meeting_bookings mb
    INNER JOIN public.meeting_slots ms ON ms.id = mb.slot_id
    INNER JOIN public.vendor_booths vb ON vb.id = ms.booth_id
    WHERE mb.id = p_meeting_booking_id AND mb.status::text IN ('confirmed', 'requested');
    IF v_mtg IS NULL THEN RETURN jsonb_build_object('error', 'invalid_meeting'); END IF;
    IF v_mtg_subj IS DISTINCT FROM v_subject OR v_mtg_event IS DISTINCT FROM v_event_id THEN
      RETURN jsonb_build_object('error', 'invalid_meeting');
    END IF;
    IF v_kind = 'vendor' THEN
      SELECT (vb.contact_user_id = v_scanner OR EXISTS (
        SELECT 1 FROM public.vendor_booth_reps vbr WHERE vbr.booth_id = vb.id AND vbr.user_id = v_scanner
      )) INTO v_is_vendor_booth
      FROM public.meeting_bookings mb2
      INNER JOIN public.meeting_slots ms2 ON ms2.id = mb2.slot_id
      INNER JOIN public.vendor_booths vb ON vb.id = ms2.booth_id
      WHERE mb2.id = p_meeting_booking_id;
      IF NOT coalesce(v_is_vendor_booth, FALSE) THEN RETURN jsonb_build_object('error', 'forbidden_meeting'); END IF;
    END IF;
    v_mtg := p_meeting_booking_id;
  ELSIF coalesce(p_attended_meeting, FALSE) THEN
    v_mtg := NULL;
  END IF;
  INSERT INTO public.badge_scans (event_id, scanner_user_id, subject_user_id, scanner_kind, attended_meeting, note, meeting_booking_id, updated_at)
  VALUES (v_event_id, v_scanner, v_subject, v_kind, coalesce(p_attended_meeting, FALSE), NULLIF(trim(p_note), ''), v_mtg, now())
  ON CONFLICT (event_id, scanner_user_id, subject_user_id) DO UPDATE SET
    attended_meeting = EXCLUDED.attended_meeting,
    note = EXCLUDED.note,
    scanner_kind = EXCLUDED.scanner_kind,
    meeting_booking_id = EXCLUDED.meeting_booking_id,
    updated_at = now();
  RETURN jsonb_build_object('ok', TRUE, 'scanner_kind', v_kind);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_badge_scan (text, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_badge_scan (text, text, boolean, uuid) TO authenticated;
