-- Announcements: only show each row to users it targets (plus event/platform admins).
-- Requires targeting columns from scripts/migrate-announcements-targeting.sql (added here if missing).

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS target_audience TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_user_ids UUID[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'announcements_target_type_check'
  ) THEN
    ALTER TABLE public.announcements
      ADD CONSTRAINT announcements_target_type_check
      CHECK (target_type IS NULL OR target_type IN ('all', 'audience', 'specific'));
  END IF;
END $$;

UPDATE public.announcements SET target_type = 'all' WHERE target_type IS NULL;

-- Stable visibility check for RLS (SECURITY DEFINER reads event_members without RLS recursion issues)
CREATE OR REPLACE FUNCTION public.user_can_view_announcement(
  p_event_id UUID,
  p_target_type TEXT,
  p_target_audience TEXT[],
  p_target_user_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN auth.uid() IS NULL THEN false
      WHEN public.is_platform_admin(auth.uid()) THEN true
      WHEN public.is_event_admin(p_event_id) THEN true
      WHEN NOT EXISTS (
        SELECT 1 FROM public.event_members em
        WHERE em.event_id = p_event_id AND em.user_id = auth.uid()
      ) THEN false
      WHEN COALESCE(p_target_type, 'all') = 'all' THEN true
      WHEN p_target_type = 'specific' THEN
        auth.uid() = ANY (COALESCE(p_target_user_ids, ARRAY[]::uuid[]))
      WHEN p_target_type = 'audience' THEN EXISTS (
        SELECT 1 FROM public.event_members em
        WHERE em.event_id = p_event_id
          AND em.user_id = auth.uid()
          AND em.role = ANY (COALESCE(p_target_audience, ARRAY[]::text[]))
      )
      ELSE false
    END;
$$;

DROP POLICY IF EXISTS "Announcements are viewable" ON public.announcements;
DROP POLICY IF EXISTS "Announcements visible to targets" ON public.announcements;

CREATE POLICY "Announcements visible to targets" ON public.announcements FOR SELECT USING (
  public.user_can_view_announcement(
    event_id,
    target_type,
    target_audience,
    target_user_ids
  )
);
