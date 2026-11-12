-- Concurrent meeting diaries: max overlapping meetings per participant in one time slot.
-- Default 1 preserves existing single-book behavior. Values > 1 allow double-booking.

ALTER TABLE public.event_registration_submissions
  ADD COLUMN IF NOT EXISTS concurrent_meetings_per_slot INTEGER NOT NULL DEFAULT 1
    CHECK (concurrent_meetings_per_slot >= 1);

COMMENT ON COLUMN public.event_registration_submissions.concurrent_meetings_per_slot IS
  'Max overlapping meetings this registrant may hold in one time window (KBM diaries).';

CREATE OR REPLACE FUNCTION public.schedule_matchmaking_review(
  p_review_id UUID,
  p_time_slot_id UUID,
  p_location_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_override_availability BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review public.event_match_reviews%ROWTYPE;
  v_slot public.event_matchmaking_time_slots%ROWTYPE;
  v_location public.event_matchmaking_locations%ROWTYPE;
  v_meeting_id UUID;
  v_max_meetings INTEGER := 8;
  v_schedule_locked BOOLEAN := false;
  v_submission_id UUID;
  v_availability_count INTEGER;
  v_location_usage INTEGER;
  v_diaries INTEGER := 1;
  v_overlap_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_review
  FROM public.event_match_reviews
  WHERE id = p_review_id;

  IF v_review.id IS NULL THEN
    RAISE EXCEPTION 'Approved match not found';
  END IF;

  IF NOT (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(v_review.event_id)
  ) THEN
    RAISE EXCEPTION 'Event admin access required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_review.event_id::TEXT, 0));

  SELECT *
  INTO v_review
  FROM public.event_match_reviews
  WHERE id = p_review_id
  FOR UPDATE;

  IF v_review.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved matches can be scheduled';
  END IF;

  SELECT *
  INTO v_slot
  FROM public.event_matchmaking_time_slots
  WHERE id = p_time_slot_id
    AND event_id = v_review.event_id
    AND is_active = true;

  IF v_slot.id IS NULL THEN
    RAISE EXCEPTION 'Active event time slot not found';
  END IF;

  SELECT *
  INTO v_location
  FROM public.event_matchmaking_locations
  WHERE id = p_location_id
    AND event_id = v_review.event_id
    AND is_active = true;

  IF v_location.id IS NULL THEN
    RAISE EXCEPTION 'Active event location not found';
  END IF;

  SELECT
    COALESCE(ems.max_meetings_per_attendee, 8),
    COALESCE(ems.schedule_locked, false)
  INTO v_max_meetings, v_schedule_locked
  FROM public.event_matchmaking_settings ems
  WHERE ems.event_id = v_review.event_id;

  IF v_schedule_locked THEN
    RAISE EXCEPTION 'The meeting schedule is locked';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_match_scheduled_meetings esm
    WHERE esm.review_id = v_review.id
      AND esm.status = 'scheduled'
  ) THEN
    RAISE EXCEPTION 'This match is already scheduled';
  END IF;

  FOREACH v_submission_id IN ARRAY ARRAY[
    v_review.from_submission_id,
    v_review.to_submission_id
  ]
  LOOP
    SELECT COALESCE(s.concurrent_meetings_per_slot, 1)
    INTO v_diaries
    FROM public.event_registration_submissions s
    WHERE s.id = v_submission_id;

    IF v_diaries IS NULL THEN
      v_diaries := 1;
    END IF;

    SELECT count(*)
    INTO v_overlap_count
    FROM public.event_match_scheduled_meetings esm
    WHERE esm.event_id = v_review.event_id
      AND esm.status = 'scheduled'
      AND (
        esm.submission_a_id = v_submission_id
        OR esm.submission_b_id = v_submission_id
      )
      AND tstzrange(esm.start_time, esm.end_time, '[)')
        && tstzrange(v_slot.start_time, v_slot.end_time, '[)');

    IF v_overlap_count >= v_diaries THEN
      RAISE EXCEPTION
        'A participant already has the maximum concurrent meetings (%) for this time slot',
        v_diaries;
    END IF;

    IF v_max_meetings > 0 AND (
      SELECT count(*)
      FROM public.event_match_scheduled_meetings esm
      WHERE esm.event_id = v_review.event_id
        AND esm.status = 'scheduled'
        AND (
          esm.submission_a_id = v_submission_id
          OR esm.submission_b_id = v_submission_id
        )
    ) >= v_max_meetings THEN
      RAISE EXCEPTION 'A participant has reached the meeting limit';
    END IF;

    SELECT count(*)
    INTO v_availability_count
    FROM public.event_matchmaking_availability ema
    WHERE ema.submission_id = v_submission_id;

    IF NOT p_override_availability
      AND v_availability_count > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_matchmaking_availability ema
        WHERE ema.submission_id = v_submission_id
          AND ema.time_slot_id = v_slot.id
          AND ema.is_available = true
      )
    THEN
      RAISE EXCEPTION 'A participant is unavailable during this time slot';
    END IF;
  END LOOP;

  SELECT count(*)
  INTO v_location_usage
  FROM public.event_match_scheduled_meetings esm
  WHERE esm.event_id = v_review.event_id
    AND esm.location_id = v_location.id
    AND esm.status = 'scheduled'
    AND tstzrange(esm.start_time, esm.end_time, '[)')
      && tstzrange(v_slot.start_time, v_slot.end_time, '[)');

  IF v_location_usage >= v_location.capacity THEN
    RAISE EXCEPTION 'This location is at capacity for the selected time slot';
  END IF;

  INSERT INTO public.event_match_scheduled_meetings (
    event_id,
    review_id,
    submission_a_id,
    submission_b_id,
    time_slot_id,
    location_id,
    start_time,
    end_time,
    location,
    notes,
    status,
    created_by
  )
  VALUES (
    v_review.event_id,
    v_review.id,
    v_review.from_submission_id,
    v_review.to_submission_id,
    v_slot.id,
    v_location.id,
    v_slot.start_time,
    v_slot.end_time,
    v_location.name,
    NULLIF(trim(p_notes), ''),
    'scheduled',
    auth.uid()
  )
  RETURNING id INTO v_meeting_id;

  RETURN v_meeting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_matchmaking_meeting(
  p_meeting_id UUID,
  p_time_slot_id UUID,
  p_location_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_override_availability BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m public.event_match_scheduled_meetings%ROWTYPE;
  v_slot public.event_matchmaking_time_slots%ROWTYPE;
  v_location public.event_matchmaking_locations%ROWTYPE;
  v_submission_id UUID;
  v_availability_count INTEGER;
  v_location_usage INTEGER;
  v_booking_slot_id UUID;
  v_diaries INTEGER := 1;
  v_overlap_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_m FROM public.event_match_scheduled_meetings WHERE id = p_meeting_id;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'Meeting not found'; END IF;
  IF NOT (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(v_m.event_id)
  ) THEN RAISE EXCEPTION 'Event admin access required'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_m.event_id::TEXT, 0));
  SELECT * INTO v_m
  FROM public.event_match_scheduled_meetings
  WHERE id = p_meeting_id
  FOR UPDATE;
  IF v_m.status <> 'scheduled' THEN RAISE EXCEPTION 'Only active meetings can be rescheduled'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_matchmaking_settings s
    WHERE s.event_id = v_m.event_id AND s.schedule_locked = true
  ) THEN RAISE EXCEPTION 'The meeting schedule is locked'; END IF;

  SELECT * INTO v_slot FROM public.event_matchmaking_time_slots
  WHERE id = p_time_slot_id AND event_id = v_m.event_id AND is_active = true;
  IF v_slot.id IS NULL THEN RAISE EXCEPTION 'Active event time slot not found'; END IF;
  SELECT * INTO v_location FROM public.event_matchmaking_locations
  WHERE id = p_location_id AND event_id = v_m.event_id AND is_active = true;
  IF v_location.id IS NULL THEN RAISE EXCEPTION 'Active event location not found'; END IF;

  FOREACH v_submission_id IN ARRAY ARRAY[v_m.submission_a_id, v_m.submission_b_id]
  LOOP
    SELECT COALESCE(s.concurrent_meetings_per_slot, 1)
    INTO v_diaries
    FROM public.event_registration_submissions s
    WHERE s.id = v_submission_id;

    IF v_diaries IS NULL THEN
      v_diaries := 1;
    END IF;

    SELECT count(*)
    INTO v_overlap_count
    FROM public.event_match_scheduled_meetings other
    WHERE other.id <> v_m.id
      AND other.event_id = v_m.event_id
      AND other.status = 'scheduled'
      AND v_submission_id IN (other.submission_a_id, other.submission_b_id)
      AND tstzrange(other.start_time, other.end_time, '[)')
        && tstzrange(v_slot.start_time, v_slot.end_time, '[)');

    IF v_overlap_count >= v_diaries THEN
      RAISE EXCEPTION
        'A participant already has the maximum concurrent meetings (%) for this time slot',
        v_diaries;
    END IF;

    SELECT count(*) INTO v_availability_count
    FROM public.event_matchmaking_availability a
    WHERE a.submission_id = v_submission_id;
    IF NOT p_override_availability
      AND v_availability_count > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.event_matchmaking_availability a
        WHERE a.submission_id = v_submission_id
          AND a.time_slot_id = v_slot.id
          AND a.is_available = true
      )
    THEN RAISE EXCEPTION 'A participant is unavailable during this time slot'; END IF;
  END LOOP;

  SELECT count(*) INTO v_location_usage
  FROM public.event_match_scheduled_meetings other
  WHERE other.id <> v_m.id
    AND other.event_id = v_m.event_id
    AND other.location_id = v_location.id
    AND other.status = 'scheduled'
    AND tstzrange(other.start_time, other.end_time, '[)')
      && tstzrange(v_slot.start_time, v_slot.end_time, '[)');
  IF v_location_usage >= v_location.capacity THEN
    RAISE EXCEPTION 'This location is at capacity for the selected time slot';
  END IF;

  UPDATE public.event_match_scheduled_meetings
  SET time_slot_id = v_slot.id,
      location_id = v_location.id,
      start_time = v_slot.start_time,
      end_time = v_slot.end_time,
      location = v_location.name,
      notes = NULLIF(trim(p_notes), ''),
      updated_at = now()
  WHERE id = v_m.id;

  IF v_m.app_booking_id IS NOT NULL THEN
    SELECT slot_id INTO v_booking_slot_id
    FROM public.meeting_bookings
    WHERE id = v_m.app_booking_id;
    IF v_booking_slot_id IS NOT NULL THEN
      UPDATE public.meeting_slots
      SET start_time = v_slot.start_time,
          end_time = v_slot.end_time,
          is_available = false
      WHERE id = v_booking_slot_id;
      UPDATE public.meeting_bookings
      SET status = 'confirmed',
          notes = COALESCE('Matchmaking: ' || v_location.name, 'Matchmaking meeting')
      WHERE id = v_m.app_booking_id;
    END IF;
  END IF;
  RETURN v_m.id;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_matchmaking_review(UUID, UUID, UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_matchmaking_review(UUID, UUID, UUID, TEXT, BOOLEAN)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reschedule_matchmaking_meeting(UUID, UUID, UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_matchmaking_meeting(UUID, UUID, UUID, TEXT, BOOLEAN)
  TO authenticated, service_role;
