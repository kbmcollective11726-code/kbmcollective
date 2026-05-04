-- Shared test guide for QA, editable only by platform admins.
CREATE TABLE IF NOT EXISTS public.platform_test_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  content text NOT NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_test_guides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can read test guides" ON public.platform_test_guides;
CREATE POLICY "Platform admins can read test guides"
ON public.platform_test_guides
FOR SELECT
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins can insert test guides" ON public.platform_test_guides;
CREATE POLICY "Platform admins can insert test guides"
ON public.platform_test_guides
FOR INSERT
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins can update test guides" ON public.platform_test_guides;
CREATE POLICY "Platform admins can update test guides"
ON public.platform_test_guides
FOR UPDATE
USING (public.is_platform_admin(auth.uid()))
WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins can delete test guides" ON public.platform_test_guides;
CREATE POLICY "Platform admins can delete test guides"
ON public.platform_test_guides
FOR DELETE
USING (public.is_platform_admin(auth.uid()));
