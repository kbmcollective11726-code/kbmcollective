-- Consolidate Phase 1 RLS checks and cover the direct availability slot FK.

CREATE INDEX IF NOT EXISTS event_matchmaking_availability_time_slot_id_idx
  ON public.event_matchmaking_availability (time_slot_id);

DROP POLICY IF EXISTS "Event admins manage matchmaking time slots"
  ON public.event_matchmaking_time_slots;
DROP POLICY IF EXISTS "Event admins insert matchmaking time slots"
  ON public.event_matchmaking_time_slots;
DROP POLICY IF EXISTS "Event admins update matchmaking time slots"
  ON public.event_matchmaking_time_slots;
DROP POLICY IF EXISTS "Event admins delete matchmaking time slots"
  ON public.event_matchmaking_time_slots;

CREATE POLICY "Event admins insert matchmaking time slots"
ON public.event_matchmaking_time_slots
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

CREATE POLICY "Event admins update matchmaking time slots"
ON public.event_matchmaking_time_slots
FOR UPDATE TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
)
WITH CHECK (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

CREATE POLICY "Event admins delete matchmaking time slots"
ON public.event_matchmaking_time_slots
FOR DELETE TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

DROP POLICY IF EXISTS "Event admins manage matchmaking locations"
  ON public.event_matchmaking_locations;
DROP POLICY IF EXISTS "Event admins insert matchmaking locations"
  ON public.event_matchmaking_locations;
DROP POLICY IF EXISTS "Event admins update matchmaking locations"
  ON public.event_matchmaking_locations;
DROP POLICY IF EXISTS "Event admins delete matchmaking locations"
  ON public.event_matchmaking_locations;

CREATE POLICY "Event admins insert matchmaking locations"
ON public.event_matchmaking_locations
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

CREATE POLICY "Event admins update matchmaking locations"
ON public.event_matchmaking_locations
FOR UPDATE TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
)
WITH CHECK (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

CREATE POLICY "Event admins delete matchmaking locations"
ON public.event_matchmaking_locations
FOR DELETE TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
);

DROP POLICY IF EXISTS "Participants manage own matchmaking availability"
  ON public.event_matchmaking_availability;
DROP POLICY IF EXISTS "Event admins manage all matchmaking availability"
  ON public.event_matchmaking_availability;
DROP POLICY IF EXISTS "Authorized users manage matchmaking availability"
  ON public.event_matchmaking_availability;

CREATE POLICY "Authorized users manage matchmaking availability"
ON public.event_matchmaking_availability
FOR ALL TO authenticated
USING (
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
  OR EXISTS (
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
  public.is_platform_admin((SELECT auth.uid()))
  OR public.is_event_admin(event_id)
  OR EXISTS (
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

