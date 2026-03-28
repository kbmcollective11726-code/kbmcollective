-- Allow multiple representatives per vendor booth.
-- Keeps vendor_booths.contact_user_id as optional primary contact for compatibility.

CREATE TABLE IF NOT EXISTS public.vendor_booth_reps (
  booth_id UUID NOT NULL REFERENCES public.vendor_booths(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (booth_id, user_id)
);

ALTER TABLE public.vendor_booth_reps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendor booth reps viewable" ON public.vendor_booth_reps;
CREATE POLICY "Vendor booth reps viewable"
ON public.vendor_booth_reps
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admins manage vendor booth reps" ON public.vendor_booth_reps;
CREATE POLICY "Admins manage vendor booth reps"
ON public.vendor_booth_reps
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.vendor_booths vb
    JOIN public.event_members em
      ON em.event_id = vb.event_id
    WHERE vb.id = vendor_booth_reps.booth_id
      AND em.user_id = auth.uid()
      AND em.role IN ('admin', 'super_admin')
  )
);

-- Backfill from existing single-contact model.
INSERT INTO public.vendor_booth_reps (booth_id, user_id)
SELECT vb.id, vb.contact_user_id
FROM public.vendor_booths vb
WHERE vb.contact_user_id IS NOT NULL
ON CONFLICT (booth_id, user_id) DO NOTHING;
