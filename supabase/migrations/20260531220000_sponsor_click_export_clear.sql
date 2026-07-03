-- Sponsor click export + platform-admin reset.

CREATE OR REPLACE FUNCTION public.list_event_sponsor_click_log(p_event_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT (public.is_platform_admin(auth.uid()) OR public.is_event_admin(p_event_id)) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY ord DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', sc.id,
      'clicked_at', sc.clicked_at,
      'placement', sc.placement,
      'sponsor_id', sc.sponsor_id,
      'sponsor_name', s.company_name,
      'sponsor_tier', s.tier_label,
      'website_url', s.website_url,
      'user_id', sc.user_id,
      'user_email', u.email,
      'user_name', u.full_name
    ) AS x,
    sc.clicked_at AS ord
    FROM public.event_sponsor_clicks sc
    JOIN public.event_sponsors s ON s.id = sc.sponsor_id
    LEFT JOIN public.users u ON u.id = sc.user_id
    WHERE sc.event_id = p_event_id
  ) q;

  RETURN jsonb_build_object('rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_event_sponsor_clicks(
  p_event_id UUID,
  p_sponsor_id UUID DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  DELETE FROM public.event_sponsor_clicks sc
  WHERE sc.event_id = p_event_id
    AND (p_sponsor_id IS NULL OR sc.sponsor_id = p_sponsor_id);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_sponsor_click_log(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_event_sponsor_click_log(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.clear_event_sponsor_clicks(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_event_sponsor_clicks(UUID, UUID) TO authenticated;
