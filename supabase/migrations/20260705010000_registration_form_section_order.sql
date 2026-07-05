-- Per-form section display order for Registration Details (admin + connect portal).

ALTER TABLE public.event_registration_forms
  ADD COLUMN IF NOT EXISTS section_order jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.event_registration_forms.section_order IS
  'Ordered section labels for this form. Empty array = use built-in defaults plus any labels on questions.';

-- Seed delegate forms with Master Build Spec section order.
UPDATE public.event_registration_forms f
SET section_order = '[
  "Identity & contact",
  "Company information",
  "Eligibility & buying intent",
  "Solution interest",
  "Meeting preferences",
  "Profile"
]'::jsonb
WHERE f.audience = 'attendee'
  AND (f.section_order IS NULL OR f.section_order = '[]'::jsonb);
