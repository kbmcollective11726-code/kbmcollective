-- RPC: return all session ratings for an event (for admin web). Event admins only.
-- Use this so admins always see all ratings regardless of RLS/joins on the client.
CREATE OR REPLACE FUNCTION public.get_event_session_feedback(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  session_id uuid,
  event_id uuid,
  user_id uuid,
  rating smallint,
  comment text,
  created_at timestamptz,
  session_title text,
  user_name text,
  user_email text
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
    r.id,
    r.session_id,
    r.event_id,
    r.user_id,
    r.rating,
    r.comment,
    r.created_at,
    s.title::text,
    u.full_name::text,
    u.email::text
  FROM public.session_ratings r
  JOIN public.schedule_sessions s ON s.id = r.session_id
  LEFT JOIN public.users u ON u.id = r.user_id
  WHERE r.event_id = p_event_id
  ORDER BY r.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_event_session_feedback(uuid) IS 'Admin web: list all session ratings for an event. Event admins only.';
