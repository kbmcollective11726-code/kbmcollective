-- Standard registration: public event website (unlisted link), FAQ, and auto-approve into the app.

ALTER TABLE public.event_matchmaking_settings
  ADD COLUMN IF NOT EXISTS standard_registration BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_approve_registrations BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_matchmaking_settings.standard_registration IS
  'Event uses Standard registration (no matchmaking): app-focused confirmation email and success text.';
COMMENT ON COLUMN public.event_matchmaking_settings.auto_approve_registrations IS
  'When true, submitted registrations are approved automatically and added to the event in the app.';

CREATE TABLE IF NOT EXISTS public.event_public_sites (
  event_id UUID PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 60),
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  faq JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(faq) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_public_sites IS
  'Public event website at /e/{slug}. Not listed anywhere; reachable only by link. FAQ is [{question, answer}].';

ALTER TABLE public.event_public_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_public_sites_admin_all ON public.event_public_sites;
CREATE POLICY event_public_sites_admin_all ON public.event_public_sites
  FOR ALL TO authenticated
  USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

REVOKE ALL ON public.event_public_sites FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_public_sites TO authenticated;

-- Everything the public site shows, in one call. Returns NULL unless the site is on and the event is active.
CREATE OR REPLACE FUNCTION public.get_public_event_site(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site public.event_public_sites;
  v_event public.events;
  v_registration_open BOOLEAN := false;
  v_form_slug TEXT;
  v_sessions JSONB;
  v_speakers JSONB;
  v_sponsors JSONB;
BEGIN
  SELECT * INTO v_site
  FROM public.event_public_sites
  WHERE slug = lower(trim(coalesce(p_slug, '')))
    AND is_enabled = true;
  IF v_site.event_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_site.event_id AND is_active = true;
  IF v_event.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(ms.registration_open, false) INTO v_registration_open
  FROM public.event_matchmaking_settings ms
  WHERE ms.event_id = v_event.id;

  SELECT f.slug INTO v_form_slug
  FROM public.event_registration_forms f
  WHERE f.event_id = v_event.id
    AND f.audience = 'attendee'
    AND f.is_active = true
  ORDER BY f.sort_order, f.name
  LIMIT 1;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'description', s.description,
    'start_time', s.start_time,
    'end_time', s.end_time,
    'day_number', s.day_number,
    'location', s.location,
    'room', s.room,
    'track', s.track,
    'session_type', s.session_type,
    'speakers', coalesce(s.speakers, '[]'::jsonb),
    'speaker_name', s.speaker_name,
    'speaker_title', s.speaker_title,
    'speaker_photo', s.speaker_photo
  ) ORDER BY s.start_time, s.sort_order, s.title), '[]'::jsonb)
  INTO v_sessions
  FROM public.schedule_sessions s
  WHERE s.event_id = v_event.id
    AND coalesce(s.is_active, true) = true;

  -- Speaker bios: event members whose name matches a listed speaker.
  WITH names AS (
    SELECT DISTINCT lower(trim(n)) AS name_key
    FROM (
      SELECT s.speaker_name AS n
      FROM public.schedule_sessions s
      WHERE s.event_id = v_event.id AND coalesce(s.is_active, true) = true
      UNION ALL
      SELECT sp ->> 'name'
      FROM public.schedule_sessions s
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.speakers) = 'array' THEN s.speakers ELSE '[]'::jsonb END
      ) sp
      WHERE s.event_id = v_event.id AND coalesce(s.is_active, true) = true
    ) raw
    WHERE n IS NOT NULL AND trim(n) <> ''
  ),
  matched AS (
    SELECT DISTINCT ON (lower(trim(u.full_name)))
      lower(trim(u.full_name)) AS name_key,
      u.bio,
      u.avatar_url,
      u.title,
      u.company
    FROM public.event_members em
    JOIN public.users u ON u.id = em.user_id
    JOIN names nm ON nm.name_key = lower(trim(u.full_name))
    WHERE em.event_id = v_event.id
      AND coalesce(em.is_active, true) = true
    ORDER BY lower(trim(u.full_name)), u.updated_at DESC NULLS LAST
  )
  SELECT coalesce(jsonb_object_agg(name_key, jsonb_build_object(
    'bio', bio,
    'avatar_url', avatar_url,
    'title', title,
    'company', company
  )), '{}'::jsonb)
  INTO v_speakers
  FROM matched;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', sp.id,
    'company_name', sp.company_name,
    'logo_url', sp.logo_url,
    'website_url', sp.website_url,
    'tier_label', sp.tier_label
  ) ORDER BY sp.sort_order, sp.company_name), '[]'::jsonb)
  INTO v_sponsors
  FROM public.event_sponsors sp
  WHERE sp.event_id = v_event.id
    AND sp.is_active = true
    AND sp.show_on_info_screen = true;

  RETURN jsonb_build_object(
    'slug', v_site.slug,
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'description', v_event.description,
      'location', v_event.location,
      'venue', v_event.venue,
      'map_url', v_event.map_url,
      'start_date', v_event.start_date,
      'end_date', v_event.end_date,
      'banner_url', v_event.banner_url,
      'portal_banner_url', v_event.portal_banner_url,
      'logo_url', v_event.logo_url,
      'theme_color', v_event.theme_color,
      'welcome_title', v_event.welcome_title,
      'welcome_subtitle', v_event.welcome_subtitle,
      'welcome_message', v_event.welcome_message,
      'reminder_timezone', v_event.reminder_timezone
    ),
    'registration_open', coalesce(v_registration_open, false) AND v_form_slug IS NOT NULL,
    'form_slug', v_form_slug,
    'sessions', v_sessions,
    'speaker_profiles', v_speakers,
    'sponsors', v_sponsors,
    'faq', v_site.faq
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_event_site(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_event_site(TEXT) TO anon, authenticated, service_role;

-- Auto-approve: hand the submission to sync-registration-membership (same path as the admin Approve button).
CREATE OR REPLACE FUNCTION public.queue_registration_auto_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto BOOLEAN;
  v_url TEXT;
  v_anon TEXT;
  v_secret TEXT;
BEGIN
  IF NEW.status <> 'submitted' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.registration_status, 'pending_review') <> 'pending_review' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(ms.auto_approve_registrations, false) INTO v_auto
  FROM public.event_matchmaking_settings ms
  WHERE ms.event_id = NEW.event_id;
  IF NOT coalesce(v_auto, false) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
    SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'anon_key' LIMIT 1;
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL;
  END;
  IF v_url IS NULL OR v_anon IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/sync-registration-membership',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon,
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object(
      'submission_id', NEW.id,
      'status', 'approved',
      'source', 'auto_approve'
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_registration_auto_approve() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_registration_auto_approve ON public.event_registration_submissions;
CREATE TRIGGER trg_registration_auto_approve
  AFTER INSERT OR UPDATE OF status ON public.event_registration_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_registration_auto_approve();
