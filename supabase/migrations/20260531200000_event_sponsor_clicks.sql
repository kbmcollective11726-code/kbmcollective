-- Sponsor logo click analytics (mobile app + optional live wall).

CREATE TABLE IF NOT EXISTS public.event_sponsor_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  sponsor_id UUID NOT NULL REFERENCES public.event_sponsors(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  placement TEXT NOT NULL CHECK (
    placement IN ('info', 'feed', 'schedule', 'hamburger_header', 'hamburger_footer', 'live_wall')
  ),
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_sponsor_clicks_event_sponsor
  ON public.event_sponsor_clicks(event_id, sponsor_id, clicked_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_sponsor_clicks_event_time
  ON public.event_sponsor_clicks(event_id, clicked_at DESC);

ALTER TABLE public.event_sponsor_clicks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event members log sponsor clicks" ON public.event_sponsor_clicks;
CREATE POLICY "Event members log sponsor clicks"
  ON public.event_sponsor_clicks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = event_sponsor_clicks.event_id
        AND em.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.event_sponsors s
      WHERE s.id = event_sponsor_clicks.sponsor_id
        AND s.event_id = event_sponsor_clicks.event_id
        AND s.is_active = true
    )
  );

DROP POLICY IF EXISTS "Event admins read sponsor clicks" ON public.event_sponsor_clicks;
CREATE POLICY "Event admins read sponsor clicks"
  ON public.event_sponsor_clicks
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_event_admin(event_id)
  );

GRANT SELECT, INSERT ON TABLE public.event_sponsor_clicks TO authenticated;

CREATE OR REPLACE FUNCTION public.list_event_sponsor_click_stats(p_event_id UUID)
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

  SELECT COALESCE(jsonb_agg(row ORDER BY total_clicks DESC, company_name ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'sponsor_id', s.id,
      'company_name', s.company_name,
      'tier_label', s.tier_label,
      'total_clicks', COALESCE(stats.total_clicks, 0),
      'unique_users', COALESCE(stats.unique_users, 0),
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

  RETURN jsonb_build_object('rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_sponsor_click_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_event_sponsor_click_stats(UUID) TO authenticated;
