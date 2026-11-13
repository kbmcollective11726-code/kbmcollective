-- Readiness check is a platform-controlled feature: event admins need the 'readiness' tile in
-- events.admin_console_tiles. Platform admins and event super_admins always have it.

ALTER FUNCTION public.admin_event_readiness(uuid) RENAME TO admin_event_readiness_core;
REVOKE ALL ON FUNCTION public.admin_event_readiness_core(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_event_readiness(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT (
    public.is_platform_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = p_event_id
        AND em.user_id = auth.uid()
        AND COALESCE(em.is_active, true)
        AND (em.role = 'super_admin' OR (em.roles IS NOT NULL AND em.roles @> ARRAY['super_admin']::text[]))
    )
    OR (
      public.is_event_admin(p_event_id)
      AND EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = p_event_id AND 'readiness' = ANY (COALESCE(e.admin_console_tiles, ARRAY[]::text[]))
      )
    )
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;
  RETURN public.admin_event_readiness_core(p_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_readiness(uuid) TO authenticated;
