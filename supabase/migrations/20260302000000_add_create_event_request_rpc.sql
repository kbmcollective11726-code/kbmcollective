-- Create event from signup "request event" flow. Runs as the authenticated user so RLS and trigger work.
CREATE OR REPLACE FUNCTION public.create_event_request(p_name text, p_contact_phone text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_start date;
  v_end date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF trim(p_name) = '' OR p_name IS NULL THEN
    RAISE EXCEPTION 'Event name required';
  END IF;
  v_start := current_date + 30;
  v_end := v_start + 1;
  INSERT INTO public.events (name, start_date, end_date, is_active, created_by, contact_phone)
  VALUES (trim(p_name), v_start, v_end, false, auth.uid(), nullif(trim(coalesce(p_contact_phone, '')), ''))
  RETURNING id INTO v_event_id;
  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION public.create_event_request(text, text) IS 'Creates an inactive event with just the name (and optional contact_phone). Used from signup when user requests to create an event. Trigger add_creator_as_event_admin adds the user as event admin.';

GRANT EXECUTE ON FUNCTION public.create_event_request(text, text) TO authenticated;
