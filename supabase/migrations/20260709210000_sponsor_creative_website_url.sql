-- Optional click-through URL per scheduled sponsor creative (falls back to sponsor website_url).
ALTER TABLE public.event_sponsor_creatives
  ADD COLUMN IF NOT EXISTS website_url TEXT;

COMMENT ON COLUMN public.event_sponsor_creatives.website_url IS
  'Optional link when this scheduled image is active; uses sponsor website_url when null.';
