-- ensure_event_badge_tokens used encode(gen_random_bytes(24), 'hex') which requires pgcrypto.
-- Use core-only token generation so it works without the extension.
CREATE OR REPLACE FUNCTION public.ensure_event_badge_tokens(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.is_event_admin(p_event_id) OR public.is_platform_admin(auth.uid())) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  INSERT INTO public.event_badge_tokens (event_id, user_id, token)
  SELECT
    p_event_id,
    em.user_id,
    substring(
      md5(random()::text || clock_timestamp()::text || random()::text)
      || md5(gen_random_uuid()::text || random()::text || clock_timestamp()::text),
      1,
      48
    )
  FROM public.event_members em
  WHERE em.event_id = p_event_id
  ON CONFLICT (event_id, user_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
