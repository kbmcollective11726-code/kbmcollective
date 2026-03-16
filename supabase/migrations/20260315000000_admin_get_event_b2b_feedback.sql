-- RPC: return all B2B meeting feedback for an event (for admin web). Event admins only.
CREATE OR REPLACE FUNCTION public.get_event_b2b_feedback(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  booking_id uuid,
  attendee_id uuid,
  attendee_name text,
  attendee_email text,
  vendor_name text,
  booth_id uuid,
  slot_start timestamptz,
  slot_end timestamptz,
  rating smallint,
  comment text,
  meet_again boolean,
  recommend_vendor boolean,
  work_with_likelihood smallint,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF NOT (public.is_event_admin(p_event_id) OR public.is_platform_admin(auth.uid())) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT
    f.id,
    f.booking_id,
    mb.attendee_id,
    u.full_name::text,
    u.email::text,
    vb.vendor_name::text,
    vb.id,
    ms.start_time,
    ms.end_time,
    f.rating,
    f.comment,
    f.meet_again,
    f.recommend_vendor,
    f.work_with_likelihood,
    f.created_at
  FROM public.b2b_meeting_feedback f
  JOIN public.meeting_bookings mb ON mb.id = f.booking_id
  JOIN public.meeting_slots ms ON ms.id = mb.slot_id
  JOIN public.vendor_booths vb ON vb.id = ms.booth_id
  JOIN public.users u ON u.id = mb.attendee_id
  WHERE vb.event_id = p_event_id
  ORDER BY f.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_event_b2b_feedback(uuid) IS 'Admin web: list all B2B meeting feedback for an event. Event admins only.';
