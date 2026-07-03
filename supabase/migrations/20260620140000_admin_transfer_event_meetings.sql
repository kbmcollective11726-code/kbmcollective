-- Move all B2B meeting bookings for an event from one attendee to another (duplicate-account fix).

CREATE OR REPLACE FUNCTION public.admin_transfer_event_meetings(
  p_event_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_transferred int := 0;
  v_skipped_conflict int := 0;
  v_rec record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  IF NOT (public.is_event_admin(p_event_id) OR public.is_platform_admin(v_uid)) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF p_from_user_id IS NULL OR p_to_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_user');
  END IF;

  IF p_from_user_id = p_to_user_id THEN
    RETURN jsonb_build_object('error', 'same_user');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = p_event_id AND em.user_id = p_to_user_id
  ) THEN
    RETURN jsonb_build_object('error', 'target_not_member');
  END IF;

  FOR v_rec IN
    SELECT mb.id AS booking_id, mb.slot_id
    FROM public.meeting_bookings mb
    INNER JOIN public.meeting_slots ms ON ms.id = mb.slot_id
    INNER JOIN public.vendor_booths vb ON vb.id = ms.booth_id
    WHERE vb.event_id = p_event_id
      AND mb.attendee_id = p_from_user_id
      AND COALESCE(mb.status, '') IS DISTINCT FROM 'cancelled'
    ORDER BY ms.start_time
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.meeting_bookings mb2
      WHERE mb2.slot_id = v_rec.slot_id
        AND mb2.attendee_id = p_to_user_id
        AND COALESCE(mb2.status, '') IS DISTINCT FROM 'cancelled'
    ) THEN
      v_skipped_conflict := v_skipped_conflict + 1;
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      UPDATE public.meeting_bookings
      SET attendee_id = p_to_user_id
      WHERE id = v_rec.booking_id;
    END IF;

    v_transferred := v_transferred + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', COALESCE(p_dry_run, false),
    'transferred', v_transferred,
    'skipped_conflict', v_skipped_conflict
  );
END;
$$;

COMMENT ON FUNCTION public.admin_transfer_event_meetings(uuid, uuid, uuid, boolean) IS
  'Event admin: move all active B2B bookings for an event from one attendee to another. dry_run=true counts without updating.';

GRANT EXECUTE ON FUNCTION public.admin_transfer_event_meetings(uuid, uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_count_event_meetings_for_user(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT (public.is_event_admin(p_event_id) OR public.is_platform_admin(v_uid)) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COUNT(*)::int INTO v_count
  FROM public.meeting_bookings mb
  INNER JOIN public.meeting_slots ms ON ms.id = mb.slot_id
  INNER JOIN public.vendor_booths vb ON vb.id = ms.booth_id
  WHERE vb.event_id = p_event_id
    AND mb.attendee_id = p_user_id
    AND COALESCE(mb.status, '') IS DISTINCT FROM 'cancelled';

  RETURN jsonb_build_object('meeting_count', v_count);
END;
$$;

COMMENT ON FUNCTION public.admin_count_event_meetings_for_user(uuid, uuid) IS
  'Event admin: count active B2B bookings for a member on an event.';

GRANT EXECUTE ON FUNCTION public.admin_count_event_meetings_for_user(uuid, uuid) TO authenticated;
