ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS badge_banner_url text;

COMMENT ON COLUMN public.events.badge_banner_url IS
  'Optional wide header artwork for printed badges (~3.75×1.52 in). When set, used instead of banner_url on badge print.';
