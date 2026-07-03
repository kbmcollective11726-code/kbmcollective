-- Token-free note save for the vendor pre-meeting brief. Lets a vendor rep/admin write a
-- note about an attendee they are meeting with (no badge scan / QR token required).
-- Writes to the same badge_scans row the badge-scan screen uses, so notes stay unified and
-- feed the "Prior interactions" history at future events. Preserves attended_meeting on update.

CREATE OR REPLACE FUNCTION public.upsert_vendor_attendee_note (
  p_event_id uuid,
  p_subject_user_id uuid,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scanner uuid := auth.uid();
  v_is_admin boolean;
  v_allowed boolean;
  r_role text;
  r_roles text[];
  v_kind text;
BEGIN
  IF v_scanner IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
  IF p_event_id IS NULL OR p_subject_user_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid_request'); END IF;
  IF p_subject_user_id = v_scanner THEN RETURN jsonb_build_object('error', 'cannot_note_self'); END IF;

  v_is_admin := public.is_event_admin(p_event_id) OR public.is_platform_admin(v_scanner);

  -- Same access rule as get_vendor_attendee_brief: admin, or a rep/contact of a current-event
  -- booth that has a (confirmed/requested) booking with this attendee.
  SELECT v_is_admin OR EXISTS (
    SELECT 1
    FROM public.meeting_bookings mb
    INNER JOIN public.meeting_slots ms ON ms.id = mb.slot_id
    INNER JOIN public.vendor_booths vb ON vb.id = ms.booth_id
    WHERE vb.event_id = p_event_id
      AND mb.attendee_id = p_subject_user_id
      AND mb.status::text IN ('confirmed', 'requested')
      AND (
        vb.contact_user_id = v_scanner
        OR EXISTS (SELECT 1 FROM public.vendor_booth_reps r WHERE r.booth_id = vb.id AND r.user_id = v_scanner)
      )
  ) INTO v_allowed;

  IF NOT coalesce(v_allowed, false) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT em.role, em.roles INTO r_role, r_roles
  FROM public.event_members em
  WHERE em.event_id = p_event_id AND em.user_id = v_scanner;
  v_kind := public.map_member_role_to_scanner_kind(COALESCE(r_role, 'attendee'), COALESCE(r_roles, ARRAY[]::text[]));

  INSERT INTO public.badge_scans (
    event_id, scanner_user_id, subject_user_id, scanner_kind, attended_meeting, note, updated_at
  ) VALUES (
    p_event_id, v_scanner, p_subject_user_id, v_kind, false, NULLIF(trim(p_note), ''), now()
  )
  ON CONFLICT (event_id, scanner_user_id, subject_user_id) DO UPDATE SET
    note = EXCLUDED.note,
    scanner_kind = EXCLUDED.scanner_kind,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_vendor_attendee_note (uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_vendor_attendee_note (uuid, uuid, text) TO authenticated;
