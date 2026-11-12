-- Public site: tell visitors whether a page is live, not live yet, or the event is no longer active.
-- Off / inactive responses carry only the event name and branding, nothing else.

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
  WHERE slug = lower(trim(coalesce(p_slug, '')));
  IF v_site.event_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_site.event_id;
  IF v_event.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_event.is_active IS DISTINCT FROM true OR v_site.is_enabled IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN v_event.is_active IS DISTINCT FROM true THEN 'inactive' ELSE 'off' END,
      'slug', v_site.slug,
      'event', jsonb_build_object(
        'id', v_event.id,
        'name', v_event.name,
        'logo_url', v_event.logo_url,
        'theme_color', v_event.theme_color
      )
    );
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
    'status', 'live',
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
