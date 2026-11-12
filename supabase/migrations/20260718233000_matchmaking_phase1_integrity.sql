-- Keep normalized matchmaking data event-scoped and eligibility-safe.
-- Authenticated admins schedule through the atomic RPC; direct inserts are blocked.

CREATE OR REPLACE FUNCTION public.enforce_matchmaking_availability_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions ers
    JOIN public.event_matchmaking_time_slots ts
      ON ts.id = NEW.time_slot_id
     AND ts.event_id = ers.event_id
    WHERE ers.id = NEW.submission_id
      AND ers.event_id = NEW.event_id
      AND ers.registration_status = 'approved'
      AND ers.profile_complete = true
      AND ers.matching_opt_in = true
      AND ts.is_active = true
  ) THEN
    RAISE EXCEPTION
      'Availability requires an eligible matchmaking participant and active event time slot';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_matchmaking_availability_integrity()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_matchmaking_availability_integrity
  ON public.event_matchmaking_availability;
CREATE TRIGGER enforce_matchmaking_availability_integrity
BEFORE INSERT OR UPDATE
ON public.event_matchmaking_availability
FOR EACH ROW
EXECUTE FUNCTION public.enforce_matchmaking_availability_integrity();

CREATE OR REPLACE FUNCTION public.enforce_scheduled_matchmaking_meeting_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot public.event_matchmaking_time_slots%ROWTYPE;
  v_location public.event_matchmaking_locations%ROWTYPE;
  v_eligible_count INTEGER;
BEGIN
  IF NEW.status <> 'scheduled' THEN
    RETURN NEW;
  END IF;

  IF NEW.submission_a_id = NEW.submission_b_id THEN
    RAISE EXCEPTION 'A participant cannot be matched with themselves';
  END IF;

  SELECT count(*)
  INTO v_eligible_count
  FROM public.event_registration_submissions ers
  WHERE ers.id IN (NEW.submission_a_id, NEW.submission_b_id)
    AND ers.event_id = NEW.event_id
    AND ers.registration_status = 'approved'
    AND ers.profile_complete = true
    AND ers.matching_opt_in = true;

  IF v_eligible_count <> 2 THEN
    RAISE EXCEPTION 'Scheduled meetings require two eligible matchmaking participants';
  END IF;

  IF NEW.time_slot_id IS NOT NULL THEN
    SELECT *
    INTO v_slot
    FROM public.event_matchmaking_time_slots ts
    WHERE ts.id = NEW.time_slot_id
      AND ts.event_id = NEW.event_id
      AND ts.is_active = true;
    IF v_slot.id IS NULL THEN
      RAISE EXCEPTION 'Scheduled meeting time slot does not belong to this event';
    END IF;
    NEW.start_time := v_slot.start_time;
    NEW.end_time := v_slot.end_time;
  END IF;

  IF NEW.location_id IS NOT NULL THEN
    SELECT *
    INTO v_location
    FROM public.event_matchmaking_locations ml
    WHERE ml.id = NEW.location_id
      AND ml.event_id = NEW.event_id
      AND ml.is_active = true;
    IF v_location.id IS NULL THEN
      RAISE EXCEPTION 'Scheduled meeting location does not belong to this event';
    END IF;
    NEW.location := v_location.name;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_scheduled_matchmaking_meeting_integrity()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_scheduled_matchmaking_meeting_integrity
  ON public.event_match_scheduled_meetings;
CREATE TRIGGER enforce_scheduled_matchmaking_meeting_integrity
BEFORE INSERT OR UPDATE OF
  event_id,
  submission_a_id,
  submission_b_id,
  time_slot_id,
  location_id,
  start_time,
  end_time,
  location,
  status
ON public.event_match_scheduled_meetings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_scheduled_matchmaking_meeting_integrity();

DROP POLICY IF EXISTS "Event admins manage scheduled matches"
  ON public.event_match_scheduled_meetings;
DROP POLICY IF EXISTS "Event admins view scheduled matches"
  ON public.event_match_scheduled_meetings;
DROP POLICY IF EXISTS "Event admins update scheduled matches"
  ON public.event_match_scheduled_meetings;
DROP POLICY IF EXISTS "Event admins delete scheduled matches"
  ON public.event_match_scheduled_meetings;

CREATE POLICY "Event admins view scheduled matches"
ON public.event_match_scheduled_meetings
FOR SELECT TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

CREATE POLICY "Event admins update scheduled matches"
ON public.event_match_scheduled_meetings
FOR UPDATE TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
)
WITH CHECK (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

CREATE POLICY "Event admins delete scheduled matches"
ON public.event_match_scheduled_meetings
FOR DELETE TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

