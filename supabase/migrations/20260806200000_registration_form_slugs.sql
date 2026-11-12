-- Multi-track registration forms: public slug per form (unique within an event).

ALTER TABLE public.event_registration_forms
  ADD COLUMN IF NOT EXISTS slug text;

COMMENT ON COLUMN public.event_registration_forms.slug IS
  'URL segment for /register/:eventId/:audience/:slug. Unique per event when set.';

-- Backfill slugs from names for existing rows.
UPDATE public.event_registration_forms f
SET slug = trim(both '-' from regexp_replace(lower(coalesce(f.name, 'form')), '[^a-z0-9]+', '-', 'g'))
WHERE f.slug IS NULL OR btrim(f.slug) = '';

-- Disambiguate collisions within the same event.
WITH ranked AS (
  SELECT
    id,
    event_id,
    slug,
    row_number() OVER (PARTITION BY event_id, slug ORDER BY sort_order, created_at, id) AS rn
  FROM public.event_registration_forms
  WHERE slug IS NOT NULL
)
UPDATE public.event_registration_forms f
SET slug = ranked.slug || '-' || ranked.rn::text
FROM ranked
WHERE f.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS event_registration_forms_event_id_slug_uidx
  ON public.event_registration_forms (event_id, slug)
  WHERE slug IS NOT NULL;
