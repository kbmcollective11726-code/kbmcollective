-- KBM Connect matchmaking Phase 1:
-- normalized slots/locations, participant availability, schedule locking,
-- meeting limits, and an atomic conflict-safe scheduling RPC.

ALTER TABLE public.event_matchmaking_settings
  ADD COLUMN IF NOT EXISTS schedule_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS availability_deadline TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.event_matchmaking_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_matchmaking_time_slots_valid_range CHECK (end_time > start_time),
  CONSTRAINT event_matchmaking_time_slots_event_range_unique
    UNIQUE (event_id, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS event_matchmaking_time_slots_event_active_start_idx
  ON public.event_matchmaking_time_slots (event_id, is_active, start_time);

CREATE TABLE IF NOT EXISTS public.event_matchmaking_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_matchmaking_locations_event_name_unique UNIQUE (event_id, name)
);

CREATE INDEX IF NOT EXISTS event_matchmaking_locations_event_active_order_idx
  ON public.event_matchmaking_locations (event_id, is_active, sort_order, name);

CREATE TABLE IF NOT EXISTS public.event_matchmaking_availability (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES public.event_registration_submissions(id) ON DELETE CASCADE,
  time_slot_id UUID NOT NULL REFERENCES public.event_matchmaking_time_slots(id) ON DELETE CASCADE,
  is_available BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, time_slot_id)
);

CREATE INDEX IF NOT EXISTS event_matchmaking_availability_event_slot_idx
  ON public.event_matchmaking_availability (event_id, time_slot_id, is_available);

ALTER TABLE public.event_match_scheduled_meetings
  ADD COLUMN IF NOT EXISTS time_slot_id UUID
    REFERENCES public.event_matchmaking_time_slots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id UUID
    REFERENCES public.event_matchmaking_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS event_match_scheduled_meetings_slot_status_idx
  ON public.event_match_scheduled_meetings (time_slot_id, status);
CREATE INDEX IF NOT EXISTS event_match_scheduled_meetings_location_status_idx
  ON public.event_match_scheduled_meetings (location_id, status);

ALTER TABLE public.event_matchmaking_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_matchmaking_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_matchmaking_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Matchmaking participants view time slots"
  ON public.event_matchmaking_time_slots;
CREATE POLICY "Matchmaking participants view time slots"
ON public.event_matchmaking_time_slots
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
  OR EXISTS (
    SELECT 1
    FROM public.event_registration_submissions ers
    WHERE ers.event_id = event_matchmaking_time_slots.event_id
      AND (
        ers.user_id = (SELECT auth.uid())
        OR public.registration_submission_owned_by_auth(ers.id)
      )
  )
);

DROP POLICY IF EXISTS "Event admins manage matchmaking time slots"
  ON public.event_matchmaking_time_slots;
CREATE POLICY "Event admins manage matchmaking time slots"
ON public.event_matchmaking_time_slots
FOR ALL
TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
)
WITH CHECK (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

DROP POLICY IF EXISTS "Matchmaking participants view locations"
  ON public.event_matchmaking_locations;
CREATE POLICY "Matchmaking participants view locations"
ON public.event_matchmaking_locations
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
  OR EXISTS (
    SELECT 1
    FROM public.event_registration_submissions ers
    WHERE ers.event_id = event_matchmaking_locations.event_id
      AND (
        ers.user_id = (SELECT auth.uid())
        OR public.registration_submission_owned_by_auth(ers.id)
      )
  )
);

DROP POLICY IF EXISTS "Event admins manage matchmaking locations"
  ON public.event_matchmaking_locations;
CREATE POLICY "Event admins manage matchmaking locations"
ON public.event_matchmaking_locations
FOR ALL
TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
)
WITH CHECK (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

DROP POLICY IF EXISTS "Participants manage own matchmaking availability"
  ON public.event_matchmaking_availability;
CREATE POLICY "Participants manage own matchmaking availability"
ON public.event_matchmaking_availability
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.event_registration_submissions ers
    WHERE ers.id = event_matchmaking_availability.submission_id
      AND ers.event_id = event_matchmaking_availability.event_id
      AND (
        ers.user_id = (SELECT auth.uid())
        OR public.registration_submission_owned_by_auth(ers.id)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.event_registration_submissions ers
    JOIN public.event_matchmaking_time_slots ts
      ON ts.id = event_matchmaking_availability.time_slot_id
    WHERE ers.id = event_matchmaking_availability.submission_id
      AND ers.event_id = event_matchmaking_availability.event_id
      AND ts.event_id = ers.event_id
      AND (
        ers.user_id = (SELECT auth.uid())
        OR public.registration_submission_owned_by_auth(ers.id)
      )
  )
);

DROP POLICY IF EXISTS "Event admins manage all matchmaking availability"
  ON public.event_matchmaking_availability;
CREATE POLICY "Event admins manage all matchmaking availability"
ON public.event_matchmaking_availability
FOR ALL
TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
)
WITH CHECK (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

CREATE OR REPLACE FUNCTION public.set_my_matchmaking_availability(
  p_submission_id UUID,
  p_time_slot_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_locked BOOLEAN;
  v_slot_ids UUID[] := COALESCE(p_time_slot_ids, ARRAY[]::UUID[]);
  v_valid_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT ers.event_id
  INTO v_event_id
  FROM public.event_registration_submissions ers
  WHERE ers.id = p_submission_id
    AND (
      ers.user_id = auth.uid()
      OR public.registration_submission_owned_by_auth(ers.id)
    );

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Registration submission not found';
  END IF;

  SELECT COALESCE(ems.schedule_locked, false)
  INTO v_locked
  FROM public.event_matchmaking_settings ems
  WHERE ems.event_id = v_event_id;

  IF v_locked THEN
    RAISE EXCEPTION 'The meeting schedule is locked';
  END IF;

  SELECT count(*)
  INTO v_valid_count
  FROM public.event_matchmaking_time_slots ts
  WHERE ts.event_id = v_event_id
    AND ts.is_active = true
    AND ts.id = ANY(v_slot_ids);

  IF v_valid_count <> cardinality(v_slot_ids) THEN
    RAISE EXCEPTION 'One or more time slots are not available for this event';
  END IF;

  DELETE FROM public.event_matchmaking_availability ema
  WHERE ema.submission_id = p_submission_id;

  INSERT INTO public.event_matchmaking_availability (
    event_id,
    submission_id,
    time_slot_id,
    is_available,
    updated_at
  )
  SELECT v_event_id, p_submission_id, slot_id, true, now()
  FROM unnest(v_slot_ids) AS slot_id
  ON CONFLICT (submission_id, time_slot_id)
  DO UPDATE SET is_available = true, updated_at = now();

  UPDATE public.event_registration_submissions
  SET meeting_availability = to_jsonb(v_slot_ids),
      updated_at = now()
  WHERE id = p_submission_id;

  RETURN cardinality(v_slot_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_matchmaking_availability(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_matchmaking_availability(UUID, UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_matchmaking_availability(UUID, UUID[])
  TO authenticated, service_role;

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
    IF EXISTS (
      SELECT 1
      FROM public.event_match_scheduled_meetings esm
      WHERE esm.event_id = v_review.event_id
        AND esm.status = 'scheduled'
        AND (
          esm.submission_a_id = v_submission_id
          OR esm.submission_b_id = v_submission_id
        )
        AND tstzrange(esm.start_time, esm.end_time, '[)')
          && tstzrange(v_slot.start_time, v_slot.end_time, '[)')
    ) THEN
      RAISE EXCEPTION 'A participant already has a meeting during this time slot';
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

REVOKE ALL ON FUNCTION public.schedule_matchmaking_review(
  UUID, UUID, UUID, TEXT, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_matchmaking_review(
  UUID, UUID, UUID, TEXT, BOOLEAN
) FROM anon;
GRANT EXECUTE ON FUNCTION public.schedule_matchmaking_review(
  UUID, UUID, UUID, TEXT, BOOLEAN
) TO authenticated, service_role;

