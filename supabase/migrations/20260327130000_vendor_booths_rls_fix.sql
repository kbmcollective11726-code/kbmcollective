-- Fix vendor booth saves returning 403 for legitimate admins:
-- 1) Platform admins (users.is_platform_admin) can manage booths without an event_members row.
-- 2) Event admins may be recorded in event_members.roles[] while role column is something else.

ALTER TABLE public.event_members
  ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.is_event_admin(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = p_event_id
      AND em.user_id = auth.uid()
      AND (
        em.role IN ('admin', 'super_admin')
        OR (
          em.roles IS NOT NULL
          AND (
            'admin' = ANY (em.roles)
            OR 'super_admin' = ANY (em.roles)
          )
        )
      )
  );
$$;

DROP POLICY IF EXISTS "Admins manage booths" ON public.vendor_booths;
CREATE POLICY "Admins manage booths" ON public.vendor_booths
FOR ALL
USING (public.is_platform_admin() OR public.is_event_admin(event_id))
WITH CHECK (public.is_platform_admin() OR public.is_event_admin(event_id));

DROP POLICY IF EXISTS "Admins manage vendor booth reps" ON public.vendor_booth_reps;
CREATE POLICY "Admins manage vendor booth reps" ON public.vendor_booth_reps
FOR ALL
USING (
  public.is_platform_admin()
  OR EXISTS (
    SELECT 1
    FROM public.vendor_booths vb
    WHERE vb.id = vendor_booth_reps.booth_id
      AND public.is_event_admin(vb.event_id)
  )
)
WITH CHECK (
  public.is_platform_admin()
  OR EXISTS (
    SELECT 1
    FROM public.vendor_booths vb
    WHERE vb.id = vendor_booth_reps.booth_id
      AND public.is_event_admin(vb.event_id)
  )
);
