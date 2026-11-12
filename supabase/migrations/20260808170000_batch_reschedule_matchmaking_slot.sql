-- Batch-move all scheduled meetings from one time slot to another.
-- Keeps each meeting's existing location/table.
-- On conflict: skip that meeting and include a detailed reason in the JSON report.
-- Does not hide/delete the source slot. Does not send notifications.

CREATE OR REPLACE FUNCTION public.batch_reschedule_matchmaking_slot(
  p_event_id UUID,
  p_from_slot_id UUID,
  p_to_slot_id UUID,
  p_override_availability BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from public.event_matchmaking_time_slots%ROWTYPE;
  v_to public.event_matchmaking_time_slots%ROWTYPE;
  v_m public.event_match_scheduled_meetings%ROWTYPE;
  v_label TEXT;
  v_moved JSONB := '[]'::JSONB;
  v_skipped JSONB := '[]'::JSONB;
  v_total INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(p_event_id)
  ) THEN
    RAISE EXCEPTION 'Event admin access required';
  END IF;

  IF p_from_slot_id = p_to_slot_id THEN
    RAISE EXCEPTION 'Choose a different destination time slot';
  END IF;

  SELECT * INTO v_from
  FROM public.event_matchmaking_time_slots
  WHERE id = p_from_slot_id AND event_id = p_event_id;
  IF v_from.id IS NULL THEN
    RAISE EXCEPTION 'Source time slot not found for this event';
  END IF;

  SELECT * INTO v_to
  FROM public.event_matchmaking_time_slots
  WHERE id = p_to_slot_id AND event_id = p_event_id AND is_active = true;
  IF v_to.id IS NULL THEN
    RAISE EXCEPTION 'Destination time slot must be an active slot on this event';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_matchmaking_settings s
    WHERE s.event_id = p_event_id AND s.schedule_locked = true
  ) THEN
    RAISE EXCEPTION 'The meeting schedule is locked';
  END IF;

  FOR v_m IN
    SELECT *
    FROM public.event_match_scheduled_meetings
    WHERE event_id = p_event_id
      AND time_slot_id = p_from_slot_id
      AND status = 'scheduled'
    ORDER BY start_time ASC, id ASC
  LOOP
    v_total := v_total + 1;

    SELECT trim(both ' ' FROM concat_ws(
      ' · ',
      NULLIF(trim(both ' ' FROM concat_ws(' ', a.first_name, a.last_name)), ''),
      NULLIF(trim(both ' ' FROM a.company_name), ''),
      NULLIF(trim(both ' ' FROM concat_ws(' ', b.first_name, b.last_name)), ''),
      NULLIF(trim(both ' ' FROM b.company_name), '')
    ))
    INTO v_label
    FROM public.event_registration_submissions a
    JOIN public.event_registration_submissions b ON b.id = v_m.submission_b_id
    WHERE a.id = v_m.submission_a_id;

    IF v_label IS NULL OR v_label = '' THEN
      v_label := v_m.id::TEXT;
    END IF;

    IF v_m.location_id IS NULL THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'meeting_id', v_m.id,
        'label', v_label,
        'reason', 'Meeting has no table/location assigned'
      ));
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.reschedule_matchmaking_meeting(
        v_m.id,
        p_to_slot_id,
        v_m.location_id,
        v_m.notes,
        p_override_availability
      );
      v_moved := v_moved || jsonb_build_array(jsonb_build_object(
        'meeting_id', v_m.id,
        'label', v_label,
        'location_id', v_m.location_id,
        'location', v_m.location
      ));
    EXCEPTION
      WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'meeting_id', v_m.id,
          'label', v_label,
          'reason', SQLERRM
        ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'from_slot_id', p_from_slot_id,
    'to_slot_id', p_to_slot_id,
    'total', v_total,
    'moved_count', jsonb_array_length(v_moved),
    'skipped_count', jsonb_array_length(v_skipped),
    'moved', v_moved,
    'skipped', v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.batch_reschedule_matchmaking_slot(UUID, UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.batch_reschedule_matchmaking_slot(UUID, UUID, UUID, BOOLEAN)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.batch_reschedule_matchmaking_slot(UUID, UUID, UUID, BOOLEAN) IS
  'Move all scheduled meetings from one slot to another; keep location; skip conflicts with JSON report.';
