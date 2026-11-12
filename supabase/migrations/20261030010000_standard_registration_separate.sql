-- Standard registration is independent of Matchmaking: its own form flag, its own
-- open/auto-approve settings on event_public_sites, and its own public read rules.

ALTER TABLE public.event_registration_forms
  ADD COLUMN IF NOT EXISTS is_standard BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_registration_forms.is_standard IS
  'Standard registration form (no matchmaking). Hidden from Matchmaking forms, portals, and match pools.';

ALTER TABLE public.event_public_sites
  ADD COLUMN IF NOT EXISTS form_id UUID REFERENCES public.event_registration_forms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS registration_open BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_approve BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.event_public_sites.registration_open IS
  'Standard registration accepts new registrations. Independent of Matchmaking registration_open.';
COMMENT ON COLUMN public.event_public_sites.auto_approve IS
  'Standard registrations are approved and added to the event in the app automatically.';

-- Matchmaking settings no longer carry standard-registration behavior.
UPDATE public.event_matchmaking_settings
SET standard_registration = false, auto_approve_registrations = false
WHERE standard_registration OR auto_approve_registrations;

COMMENT ON COLUMN public.event_matchmaking_settings.standard_registration IS
  'Deprecated: Standard registration uses event_public_sites and event_registration_forms.is_standard.';
COMMENT ON COLUMN public.event_matchmaking_settings.auto_approve_registrations IS
  'Deprecated: Standard registration uses event_public_sites.auto_approve.';

CREATE OR REPLACE FUNCTION public.is_standard_registration_form_open(p_form_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_registration_forms f
    JOIN public.event_public_sites s ON s.form_id = f.id
    JOIN public.events e ON e.id = f.event_id
    WHERE f.id = p_form_id
      AND f.is_standard = true
      AND f.is_active = true
      AND s.registration_open = true
      AND e.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_standard_registration_form_open(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_standard_registration_form_open(UUID) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS event_registration_forms_standard_public_read ON public.event_registration_forms;
CREATE POLICY event_registration_forms_standard_public_read ON public.event_registration_forms
  FOR SELECT TO anon, authenticated
  USING (is_standard = true AND public.is_standard_registration_form_open(id));

DROP POLICY IF EXISTS event_registration_questions_standard_public_read ON public.event_registration_questions;
CREATE POLICY event_registration_questions_standard_public_read ON public.event_registration_questions
  FOR SELECT TO anon, authenticated
  USING (public.is_standard_registration_form_open(form_id));

DROP POLICY IF EXISTS event_registration_question_options_standard_public_read ON public.event_registration_question_options;
CREATE POLICY event_registration_question_options_standard_public_read ON public.event_registration_question_options
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_registration_questions q
      WHERE q.id = event_registration_question_options.question_id
        AND public.is_standard_registration_form_open(q.form_id)
    )
  );

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
  v_form_ok BOOLEAN := false;
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

  v_form_ok := v_site.form_id IS NOT NULL AND public.is_standard_registration_form_open(v_site.form_id);

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
    'registration_open', v_form_ok,
    'form_id', CASE WHEN v_form_ok THEN v_site.form_id END,
    'sessions', v_sessions,
    'speaker_profiles', v_speakers,
    'sponsors', v_sponsors,
    'faq', v_site.faq
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_event_site(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_event_site(TEXT) TO anon, authenticated, service_role;

-- Auto-approve only standard-form submissions whose site has auto-approve on.
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

  SELECT coalesce(s.auto_approve, false) INTO v_auto
  FROM public.event_registration_forms f
  JOIN public.event_public_sites s ON s.form_id = f.id
  WHERE f.id = NEW.form_id
    AND f.is_standard = true;
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
