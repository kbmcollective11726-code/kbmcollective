-- B2B: Only admins can create, edit, and cancel meeting bookings.
-- Attendees cannot self-book or cancel; vendors cannot cancel or update.

-- Remove attendee self-booking (only admins assign)
DROP POLICY IF EXISTS "Users can book" ON public.meeting_bookings;

-- Remove attendee self-cancel
DROP POLICY IF EXISTS "Users can cancel own bookings" ON public.meeting_bookings;

-- Remove vendor update (confirm/decline/cancel); only admins can update
DROP POLICY IF EXISTS "Vendors and admins can update event booth bookings" ON public.meeting_bookings;

-- Only event admins/super_admins can update meeting bookings (edit or cancel)
CREATE POLICY "Admins can update meeting bookings" ON public.meeting_bookings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id
        AND em.user_id = auth.uid()
        AND em.role IN ('admin', 'super_admin')
      WHERE ms.id = meeting_bookings.slot_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id
        AND em.user_id = auth.uid()
        AND em.role IN ('admin', 'super_admin')
      WHERE ms.id = meeting_bookings.slot_id
    )
  );
