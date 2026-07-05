ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS portal_banner_url text;

COMMENT ON COLUMN public.events.portal_banner_url IS
  'Wide header for connect.kbmcollective.org delegate/vendor portal (~1400×360). Falls back to badge_banner_url, then app banner, then logo.';
