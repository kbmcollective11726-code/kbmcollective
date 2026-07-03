-- Sponsor click analytics: attendee denominator (excl. event admins) + click rate per sponsor.

CREATE OR REPLACE FUNCTION public.list_event_sponsor_click_stats(p_event_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_attendee_count INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT (public.is_platform_admin(auth.uid()) OR public.is_event_admin(p_event_id)) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COUNT(*)::INT INTO v_attendee_count
  FROM public.event_members em
  WHERE em.event_id = p_event_id
    AND NOT (
      em.role IN ('admin', 'super_admin')
      OR 'admin' = ANY (COALESCE(em.roles, ARRAY[]::text[]))
      OR 'super_admin' = ANY (COALESCE(em.roles, ARRAY[]::text[]))
    );

  SELECT COALESCE(jsonb_agg(row ORDER BY total_clicks DESC, company_name ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'sponsor_id', s.id,
      'company_name', s.company_name,
      'tier_label', s.tier_label,
      'total_clicks', COALESCE(stats.total_clicks, 0),
      'unique_users', COALESCE(stats.unique_users, 0),
      'click_rate_pct', CASE
        WHEN v_attendee_count > 0 THEN
          ROUND(100.0 * COALESCE(stats.unique_users, 0)::numeric / v_attendee_count, 1)
        ELSE NULL
      END,
      'by_placement', COALESCE(stats.by_placement, '{}'::jsonb)
    ) AS row,
    COALESCE(stats.total_clicks, 0) AS total_clicks,
    s.company_name
    FROM public.event_sponsors s
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::INT AS total_clicks,
        COUNT(DISTINCT sc.user_id)::INT AS unique_users,
        (
          SELECT COALESCE(jsonb_object_agg(p.placement, p.cnt), '{}'::jsonb)
          FROM (
            SELECT sc2.placement, COUNT(*)::INT AS cnt
            FROM public.event_sponsor_clicks sc2
            WHERE sc2.event_id = p_event_id AND sc2.sponsor_id = s.id
            GROUP BY sc2.placement
          ) p
        ) AS by_placement
      FROM public.event_sponsor_clicks sc
      WHERE sc.event_id = p_event_id AND sc.sponsor_id = s.id
    ) stats ON true
    WHERE s.event_id = p_event_id
  ) x;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'attendee_count', v_attendee_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_sponsor_click_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_event_sponsor_click_stats(UUID) TO authenticated;
