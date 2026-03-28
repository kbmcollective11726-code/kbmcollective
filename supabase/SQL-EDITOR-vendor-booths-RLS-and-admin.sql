-- =============================================================================
-- Vendor booths: fix RLS + grant yourself access (run in Supabase SQL Editor)
-- Error: "new row violates row-level security policy for table vendor_booths"
-- =============================================================================
-- PART 1 — Policies (same as migration 20260327130000_vendor_booths_rls_fix.sql)
-- =============================================================================

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

-- =============================================================================
-- PART 2 — Grant access to YOUR login (pick ONE approach; uncomment and edit)
-- =============================================================================
-- The web admin uses the Supabase session user (auth.uid()). That user must be
-- either (A) platform admin, or (B) event admin for the event you are editing.

-- (A) Platform admin — can manage all events (replace email):
-- UPDATE public.users SET is_platform_admin = true WHERE email = 'your-email@example.com';

-- (B) Event admin for one event — replace email and event id (from URL or events table):
-- INSERT INTO public.event_members (event_id, user_id, role)
-- SELECT e.id, u.id, 'admin'
-- FROM public.events e
-- JOIN public.users u ON u.email = 'your-email@example.com'
-- WHERE e.id = '00000000-0000-0000-0000-000000000000'::uuid
-- ON CONFLICT (event_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- =============================================================================
-- PART 3 — vendor_booth_reps policies (only after table exists; see migration
--          20260326090000_vendor_booth_multi_reps.sql). Skip if you get
--          "relation vendor_booth_reps does not exist".
-- =============================================================================
-- DROP POLICY IF EXISTS "Admins manage vendor booth reps" ON public.vendor_booth_reps;
-- CREATE POLICY "Admins manage vendor booth reps" ON public.vendor_booth_reps
-- FOR ALL
-- USING (
--   public.is_platform_admin()
--   OR EXISTS (
--     SELECT 1 FROM public.vendor_booths vb
--     WHERE vb.id = vendor_booth_reps.booth_id AND public.is_event_admin(vb.event_id)
--   )
-- )
-- WITH CHECK (
--   public.is_platform_admin()
--   OR EXISTS (
--     SELECT 1 FROM public.vendor_booths vb
--     WHERE vb.id = vendor_booth_reps.booth_id AND public.is_event_admin(vb.event_id)
--   )
-- );

-- =============================================================================
-- PART 4 — Optional: verify policies
-- =============================================================================
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies WHERE tablename IN ('vendor_booths', 'vendor_booth_reps') ORDER BY tablename, policyname;
