-- Matchmaking Phase 2: received requests, participant schedules, and
-- conflict-safe reschedule/cancel synchronization with the mobile app.

ALTER TABLE public.event_meeting_interest_requests
  ADD COLUMN IF NOT EXISTS response_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

ALTER TABLE public.event_meeting_interest_requests
  DROP CONSTRAINT IF EXISTS event_meeting_interest_requests_response_status_check;
ALTER TABLE public.event_meeting_interest_requests
  ADD CONSTRAINT event_meeting_interest_requests_response_status_check
  CHECK (response_status IN ('pending', 'accepted', 'declined'));

ALTER TABLE public.event_meeting_interest_requests
  DROP CONSTRAINT IF EXISTS event_meeting_interest_requests_priority_nonnegative;
ALTER TABLE public.event_meeting_interest_requests
  ADD CONSTRAINT event_meeting_interest_requests_priority_nonnegative
  CHECK (priority >= 0);

CREATE OR REPLACE FUNCTION public.enforce_meeting_request_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.event_registration_submissions%ROWTYPE;
  v_target public.event_registration_submissions%ROWTYPE;
  v_is_admin BOOLEAN;
  v_is_recipient BOOLEAN;
BEGIN
  SELECT * INTO v_source
  FROM public.event_registration_submissions
  WHERE id = NEW.submission_id;
  SELECT * INTO v_target
  FROM public.event_registration_submissions
  WHERE id = NEW.target_submission_id;

  IF v_source.id IS NULL OR v_target.id IS NULL
    OR v_source.event_id <> NEW.event_id
    OR v_target.event_id <> NEW.event_id
    OR v_source.id = v_target.id
    OR v_source.attendee_type = v_target.attendee_type
    OR v_target.status <> 'submitted'
    OR v_target.registration_status <> 'approved'
    OR v_target.profile_complete <> true
    OR v_target.matching_opt_in <> true
  THEN
    RAISE EXCEPTION 'Meeting request participants are not eligible';
  END IF;

  v_is_admin :=
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(NEW.event_id);

  IF TG_OP = 'INSERT' THEN
    NEW.response_status := 'pending';
    NEW.responded_at := NULL;
  ELSE
    IF NOT v_is_admin AND (
      NEW.event_id <> OLD.event_id
      OR NEW.submission_id <> OLD.submission_id
      OR NEW.target_submission_id IS DISTINCT FROM OLD.target_submission_id
    ) THEN
      RAISE EXCEPTION 'Meeting request participants cannot be changed';
    END IF;

    IF NEW.response_status IS DISTINCT FROM OLD.response_status THEN
      v_is_recipient :=
        v_target.user_id = auth.uid()
        OR public.registration_submission_owned_by_auth(v_target.id);
      IF NOT v_is_admin AND NOT v_is_recipient THEN
        RAISE EXCEPTION 'Only the request recipient can respond';
      END IF;
      NEW.responded_at := CASE
        WHEN NEW.response_status = 'pending' THEN NULL
        ELSE now()
      END;
    ELSIF NOT v_is_admin AND NEW.responded_at IS DISTINCT FROM OLD.responded_at THEN
      RAISE EXCEPTION 'Response time is managed automatically';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_meeting_request_integrity()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_meeting_request_integrity
  ON public.event_meeting_interest_requests;
CREATE TRIGGER enforce_meeting_request_integrity
BEFORE INSERT OR UPDATE
ON public.event_meeting_interest_requests
FOR EACH ROW
EXECUTE FUNCTION public.enforce_meeting_request_integrity();

CREATE OR REPLACE FUNCTION public.list_my_received_meeting_requests(
  p_event_id UUID,
  p_submission_id UUID
)
RETURNS TABLE (
  id UUID,
  event_id UUID,
  submission_id UUID,
  target_submission_id UUID,
  sender_first_name TEXT,
  sender_last_name TEXT,
  sender_company_name TEXT,
  sender_job_title TEXT,
  reason TEXT,
  interest_level TEXT,
  response_status TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions s
    WHERE s.id = p_submission_id
      AND s.event_id = p_event_id
      AND (
        s.user_id = auth.uid()
        OR public.registration_submission_owned_by_auth(s.id)
        OR public.is_event_admin(s.event_id)
        OR public.is_platform_admin(auth.uid())
      )
  ) THEN
    RAISE EXCEPTION 'Not authorized for this submission';
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.event_id, r.submission_id, r.target_submission_id,
    s.first_name, s.last_name, s.company_name, s.job_title,
    r.reason, r.interest_level, r.response_status, r.responded_at, r.created_at
  FROM public.event_meeting_interest_requests r
  JOIN public.event_registration_submissions s ON s.id = r.submission_id
  WHERE r.event_id = p_event_id
    AND r.target_submission_id = p_submission_id
  ORDER BY
    CASE r.response_status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
    r.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_received_meeting_requests(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_received_meeting_requests(UUID, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.respond_to_meeting_request(
  p_request_id UUID,
  p_response_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.event_meeting_interest_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_response_status NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'Response must be accepted or declined';
  END IF;

  SELECT * INTO v_request
  FROM public.event_meeting_interest_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Meeting request not found'; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions s
    WHERE s.id = v_request.target_submission_id
      AND (
        s.user_id = auth.uid()
        OR public.registration_submission_owned_by_auth(s.id)
      )
  ) THEN
    RAISE EXCEPTION 'Only the request recipient can respond';
  END IF;
  IF NOT public.is_event_meeting_requests_open(v_request.event_id) THEN
    RAISE EXCEPTION 'Meeting requests are closed';
  END IF;

  UPDATE public.event_meeting_interest_requests
  SET response_status = p_response_status
  WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_meeting_request(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_meeting_request(UUID, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_my_meeting_request_priorities(
  p_submission_id UUID,
  p_request_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.event_registration_submissions%ROWTYPE;
  v_ids UUID[] := COALESCE(p_request_ids, ARRAY[]::UUID[]);
  v_count INTEGER;
BEGIN
  v_source := public.assert_meeting_request_caller(p_submission_id);

  PERFORM 1
  FROM public.event_meeting_interest_requests r
  WHERE r.submission_id = p_submission_id
  FOR UPDATE;

  SELECT count(*) INTO v_count
  FROM public.event_meeting_interest_requests r
  WHERE r.submission_id = p_submission_id;
  IF v_count <> cardinality(v_ids)
    OR (SELECT count(DISTINCT id) FROM unnest(v_ids) AS id) <> cardinality(v_ids)
    OR EXISTS (
      SELECT 1 FROM unnest(v_ids) AS id
      WHERE NOT EXISTS (
        SELECT 1 FROM public.event_meeting_interest_requests r
        WHERE r.id = id AND r.submission_id = p_submission_id
      )
    )
  THEN
    RAISE EXCEPTION 'Priority list must contain every sent request exactly once';
  END IF;

  UPDATE public.event_meeting_interest_requests r
  SET priority = ranked.priority, updated_at = now()
  FROM (
    SELECT id, (ordinality - 1)::INTEGER AS priority
    FROM unnest(v_ids) WITH ORDINALITY AS u(id, ordinality)
  ) ranked
  WHERE r.id = ranked.id
    AND r.submission_id = p_submission_id;

  RETURN cardinality(v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_meeting_request_priorities(UUID, UUID[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_meeting_request_priorities(UUID, UUID[])
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_my_matchmaking_schedule(
  p_event_id UUID,
  p_submission_id UUID
)
RETURNS TABLE (
  id UUID,
  counterpart_submission_id UUID,
  counterpart_first_name TEXT,
  counterpart_last_name TEXT,
  counterpart_company_name TEXT,
  counterpart_job_title TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  location TEXT,
  slot_label TEXT,
  status TEXT,
  published_to_app_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions s
    WHERE s.id = p_submission_id
      AND s.event_id = p_event_id
      AND (
        s.user_id = auth.uid()
        OR public.registration_submission_owned_by_auth(s.id)
        OR public.is_event_admin(s.event_id)
        OR public.is_platform_admin(auth.uid())
      )
  ) THEN
    RAISE EXCEPTION 'Not authorized for this submission';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    counterpart.id,
    counterpart.first_name,
    counterpart.last_name,
    counterpart.company_name,
    counterpart.job_title,
    m.start_time,
    m.end_time,
    m.location,
    ts.label,
    m.status,
    m.published_to_app_at
  FROM public.event_match_scheduled_meetings m
  JOIN public.event_registration_submissions counterpart
    ON counterpart.id = CASE
      WHEN m.submission_a_id = p_submission_id THEN m.submission_b_id
      ELSE m.submission_a_id
    END
  LEFT JOIN public.event_matchmaking_time_slots ts ON ts.id = m.time_slot_id
  WHERE m.event_id = p_event_id
    AND p_submission_id IN (m.submission_a_id, m.submission_b_id)
  ORDER BY m.start_time, counterpart.company_name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_matchmaking_schedule(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_matchmaking_schedule(UUID, UUID)
  TO authenticated, service_role;

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
    IF EXISTS (
      SELECT 1 FROM public.event_match_scheduled_meetings other
      WHERE other.id <> v_m.id
        AND other.event_id = v_m.event_id
        AND other.status = 'scheduled'
        AND v_submission_id IN (other.submission_a_id, other.submission_b_id)
        AND tstzrange(other.start_time, other.end_time, '[)')
          && tstzrange(v_slot.start_time, v_slot.end_time, '[)')
    ) THEN RAISE EXCEPTION 'A participant already has a meeting during this time slot'; END IF;

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

REVOKE ALL ON FUNCTION public.reschedule_matchmaking_meeting(UUID, UUID, UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_matchmaking_meeting(UUID, UUID, UUID, TEXT, BOOLEAN)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_matchmaking_meeting(p_meeting_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m public.event_match_scheduled_meetings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_m
  FROM public.event_match_scheduled_meetings
  WHERE id = p_meeting_id
  FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'Meeting not found'; END IF;
  IF NOT (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(v_m.event_id)
  ) THEN RAISE EXCEPTION 'Event admin access required'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_matchmaking_settings s
    WHERE s.event_id = v_m.event_id AND s.schedule_locked = true
  ) THEN RAISE EXCEPTION 'The meeting schedule is locked'; END IF;

  UPDATE public.event_match_scheduled_meetings
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_m.id;
  IF v_m.app_booking_id IS NOT NULL THEN
    UPDATE public.meeting_bookings
    SET status = 'cancelled'
    WHERE id = v_m.app_booking_id;
  END IF;
  RETURN v_m.id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_matchmaking_meeting(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_matchmaking_meeting(UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.publish_matchmaking_meeting_to_app(p_meeting_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m public.event_match_scheduled_meetings%ROWTYPE;
  v_delegate_user UUID;
  v_vendor_sub UUID;
  v_vendor_user UUID;
  v_booth_id UUID;
  v_slot_id UUID;
  v_booking_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_m
  FROM public.event_match_scheduled_meetings
  WHERE id = p_meeting_id
  FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'Meeting not found'; END IF;
  IF NOT (
    public.is_event_admin(v_m.event_id)
    OR public.is_platform_admin(auth.uid())
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_m.status <> 'scheduled' THEN RAISE EXCEPTION 'Meeting is not active'; END IF;

  IF v_m.app_booking_id IS NOT NULL THEN
    SELECT b.id, b.slot_id
    INTO v_booking_id, v_slot_id
    FROM public.meeting_bookings b
    WHERE b.id = v_m.app_booking_id;
    IF v_booking_id IS NOT NULL THEN
      UPDATE public.meeting_slots
      SET start_time = v_m.start_time,
          end_time = v_m.end_time,
          is_available = false
      WHERE id = v_slot_id;
      UPDATE public.meeting_bookings
      SET status = 'confirmed',
          notes = COALESCE('Matchmaking: ' || v_m.location, 'Matchmaking meeting')
      WHERE id = v_booking_id;
      UPDATE public.event_match_scheduled_meetings
      SET published_to_app_at = now(), updated_at = now()
      WHERE id = v_m.id;
      RETURN v_booking_id;
    END IF;
  END IF;

  SELECT s.user_id INTO v_delegate_user
  FROM public.event_registration_submissions s
  WHERE s.id IN (v_m.submission_a_id, v_m.submission_b_id)
    AND s.attendee_type = 'attendee'
  LIMIT 1;
  SELECT s.id, s.user_id INTO v_vendor_sub, v_vendor_user
  FROM public.event_registration_submissions s
  WHERE s.id IN (v_m.submission_a_id, v_m.submission_b_id)
    AND s.attendee_type = 'vendor'
  LIMIT 1;
  IF v_delegate_user IS NULL OR v_vendor_user IS NULL THEN
    RAISE EXCEPTION 'Linked delegate and vendor accounts are required';
  END IF;

  SELECT vb.id INTO v_booth_id
  FROM public.vendor_booths vb
  WHERE vb.event_id = v_m.event_id
    AND (
      vb.contact_user_id = v_vendor_user
      OR vb.vendor_name ILIKE (
        SELECT company_name
        FROM public.event_registration_submissions
        WHERE id = v_vendor_sub
      )
    )
  ORDER BY vb.created_at
  LIMIT 1;
  IF v_booth_id IS NULL THEN
    INSERT INTO public.vendor_booths (event_id, vendor_name, contact_user_id, is_active)
    SELECT v_m.event_id, COALESCE(s.company_name, 'Vendor'), v_vendor_user, true
    FROM public.event_registration_submissions s
    WHERE s.id = v_vendor_sub
    RETURNING id INTO v_booth_id;
  END IF;

  INSERT INTO public.meeting_slots (booth_id, start_time, end_time, is_available)
  VALUES (v_booth_id, v_m.start_time, v_m.end_time, false)
  RETURNING id INTO v_slot_id;
  INSERT INTO public.meeting_bookings (slot_id, attendee_id, status, notes)
  VALUES (
    v_slot_id,
    v_delegate_user,
    'confirmed',
    COALESCE('Matchmaking: ' || v_m.location, 'Matchmaking meeting')
  )
  RETURNING id INTO v_booking_id;
  UPDATE public.event_match_scheduled_meetings
  SET published_to_app_at = now(),
      app_booking_id = v_booking_id,
      updated_at = now()
  WHERE id = v_m.id;
  RETURN v_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_matchmaking_meeting_to_app(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_matchmaking_meeting_to_app(UUID)
  TO authenticated, service_role;

-- All participant/admin mutations now flow through conflict-safe RPCs.
DROP POLICY IF EXISTS "Event admins update scheduled matches"
  ON public.event_match_scheduled_meetings;
DROP POLICY IF EXISTS "Event admins delete scheduled matches"
  ON public.event_match_scheduled_meetings;

