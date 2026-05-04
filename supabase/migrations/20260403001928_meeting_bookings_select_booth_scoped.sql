-- B2B privacy: restrict which meeting_bookings rows non-attendees can SELECT.
-- The previous "Vendors and admins can view event booth bookings" policy allowed any
-- event member with vendor role to read every booking in the event (any booth).
-- Replace with booth-scoped access: event admins, booth contact, or booth reps only.
-- Unchanged: "Users see own bookings" (attendee_id = auth.uid()) and platform admin policy.

DROP POLICY IF EXISTS "Vendors and admins can view event booth bookings" ON public.meeting_bookings;

CREATE POLICY "Booth reps and event admins can view booth bookings" ON public.meeting_bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      WHERE ms.id = meeting_bookings.slot_id
        AND (
          public.is_event_admin(vb.event_id)
          OR vb.contact_user_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.vendor_booth_reps vbr
            WHERE vbr.booth_id = vb.id
              AND vbr.user_id = auth.uid()
          )
        )
    )
  );
