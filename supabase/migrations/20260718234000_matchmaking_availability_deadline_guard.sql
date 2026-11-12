-- Enforce the availability window in PostgreSQL so a modified client cannot
-- change selections after the deadline or after the schedule is locked.

CREATE OR REPLACE FUNCTION public.enforce_matchmaking_availability_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID := COALESCE(NEW.event_id, OLD.event_id);
  v_locked BOOLEAN := false;
  v_deadline TIMESTAMPTZ;
BEGIN
  IF NOT (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(v_event_id)
  ) THEN
    SELECT
      COALESCE(ems.schedule_locked, false),
      ems.availability_deadline
    INTO v_locked, v_deadline
    FROM public.event_matchmaking_settings ems
    WHERE ems.event_id = v_event_id;

    IF v_locked THEN
      RAISE EXCEPTION 'The meeting schedule is locked';
    END IF;
    IF v_deadline IS NOT NULL AND now() > v_deadline THEN
      RAISE EXCEPTION 'The meeting availability deadline has passed';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

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
BEFORE INSERT OR UPDATE OR DELETE
ON public.event_matchmaking_availability
FOR EACH ROW
EXECUTE FUNCTION public.enforce_matchmaking_availability_integrity();

