-- Allow platform admins to assign and update meeting bookings and manage slots (web admin).

-- meeting_slots: platform admins can insert/update/delete (e.g. Add slot)
DROP POLICY IF EXISTS "Platform admins manage slots" ON public.meeting_slots;
CREATE POLICY "Platform admins manage slots" ON public.meeting_slots
  FOR ALL USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can assign meeting bookings" ON public.meeting_bookings;
CREATE POLICY "Admins can assign meeting bookings" ON public.meeting_bookings
  FOR INSERT WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin')
      WHERE ms.id = meeting_bookings.slot_id
    )
  );

DROP POLICY IF EXISTS "Admins can update meeting bookings" ON public.meeting_bookings;
CREATE POLICY "Admins can update meeting bookings" ON public.meeting_bookings
  FOR UPDATE
  USING (
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id
        AND em.user_id = auth.uid()
        AND em.role IN ('admin', 'super_admin')
      WHERE ms.id = meeting_bookings.slot_id
    )
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.meeting_slots ms
      JOIN public.vendor_booths vb ON vb.id = ms.booth_id
      JOIN public.event_members em ON em.event_id = vb.event_id
        AND em.user_id = auth.uid()
        AND em.role IN ('admin', 'super_admin')
      WHERE ms.id = meeting_bookings.slot_id
    )
  );
