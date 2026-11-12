-- Restrict open-registration uploads to logos/headshots only (not chat/feed).
CREATE OR REPLACE FUNCTION private.can_upload_event_photo_object(
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_event_id_text text;
  v_event_id uuid;
  v_relative_path text;
  v_folder text;
  v_filename text;
  v_owned_file boolean;
  v_platform_admin boolean := false;
  v_event_admin boolean := false;
  v_is_member boolean := false;
  v_is_registrant boolean := false;
  v_registration_open boolean := false;
BEGIN
  IF v_user_id IS NULL
    OR p_object_name IS NULL
    OR length(p_object_name) > 500
    OR p_object_name LIKE '/%'
    OR p_object_name LIKE '%..%'
    OR position(E'\\' IN p_object_name) > 0
    OR p_object_name LIKE '%//%'
  THEN
    RETURN false;
  END IF;

  v_event_id_text := split_part(p_object_name, '/', 1);
  IF v_event_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  v_event_id := v_event_id_text::uuid;
  v_relative_path := substring(p_object_name FROM length(v_event_id_text) + 2);
  IF v_relative_path IS NULL OR v_relative_path = '' THEN
    RETURN false;
  END IF;

  v_filename := storage.filename(p_object_name);
  v_folder := CASE
    WHEN position('/' IN v_relative_path) > 0
      THEN split_part(v_relative_path, '/', 1)
    ELSE ''
  END;
  v_owned_file :=
    left(v_filename, length(v_user_id::text) + 1) = v_user_id::text || '_'
    AND lower(v_filename) ~ '\.(jpg|jpeg|png|webp)$';

  v_platform_admin := public.is_platform_admin(v_user_id);
  v_event_admin := v_platform_admin
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = v_event_id AND e.created_by = v_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.event_members em
      WHERE em.event_id = v_event_id
        AND em.user_id = v_user_id
        AND (
          em.role IN ('admin', 'super_admin')
          OR COALESCE(em.roles, ARRAY[]::text[]) && ARRAY['admin', 'super_admin']::text[]
        )
    );

  v_is_member := EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = v_event_id AND em.user_id = v_user_id
  );
  v_is_registrant := EXISTS (
    SELECT 1 FROM public.event_registration_submissions ers
    WHERE ers.event_id = v_event_id AND ers.user_id = v_user_id
  );

  SELECT COALESCE(s.registration_open, false)
  INTO v_registration_open
  FROM public.event_matchmaking_settings s
  WHERE s.event_id = v_event_id;

  -- First-time registrants (account created, not yet submitted): logos + headshots only.
  IF v_registration_open
    AND NOT v_event_admin
    AND NOT v_is_member
    AND NOT v_is_registrant
  THEN
    RETURN v_folder IN ('vendor-logos', 'registration-headshots')
      AND v_relative_path = v_folder || '/' || v_filename
      AND v_owned_file;
  END IF;

  IF NOT (v_event_admin OR v_is_member OR v_is_registrant) THEN
    RETURN false;
  END IF;

  -- Standard attendee photo posts (members only).
  IF (v_event_admin OR v_is_member)
    AND v_folder = ''
    AND v_relative_path = v_filename
    AND v_owned_file
  THEN
    RETURN true;
  END IF;

  -- Member/registrant-owned chat, group, vendor logo, and registration headshot images.
  IF v_folder IN ('chat', 'group-chat', 'vendor-logos', 'registration-headshots')
    AND v_relative_path = v_folder || '/' || v_filename
    AND v_owned_file
  THEN
    -- Registrants without membership may only use logo/headshot folders.
    IF v_is_registrant AND NOT v_is_member AND NOT v_event_admin THEN
      RETURN v_folder IN ('vendor-logos', 'registration-headshots');
    END IF;
    RETURN true;
  END IF;

  -- Registration attachments remain event-scoped.
  IF v_folder = 'vendor-attachments'
    AND v_relative_path = v_folder || '/' || v_filename
    AND v_filename <> ''
    AND (v_event_admin OR v_is_member OR v_is_registrant)
  THEN
    RETURN true;
  END IF;

  IF NOT v_event_admin THEN
    RETURN false;
  END IF;

  IF v_folder = ''
    AND v_relative_path = v_filename
    AND lower(v_filename) ~ '^(banner|badge_banner|portal_banner)_[0-9]+\.(jpg|jpeg|png|webp)$'
  THEN
    RETURN true;
  END IF;

  RETURN v_folder = 'sponsor-logos'
    AND v_relative_path = v_folder || '/' || v_filename
    AND v_owned_file;
END;
$$;
