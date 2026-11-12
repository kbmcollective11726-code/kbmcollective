-- Keep direct Supabase Storage uploads fast while preventing an authenticated
-- client from choosing another event's object prefix.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

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
  v_event_access boolean := false;
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
      SELECT 1
      FROM public.events e
      WHERE e.id = v_event_id
        AND e.created_by = v_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.event_members em
      WHERE em.event_id = v_event_id
        AND em.user_id = v_user_id
        AND (
          em.role IN ('admin', 'super_admin')
          OR COALESCE(em.roles, ARRAY[]::text[]) && ARRAY['admin', 'super_admin']::text[]
        )
    );

  v_event_access := v_event_admin
    OR EXISTS (
      SELECT 1
      FROM public.event_members em
      WHERE em.event_id = v_event_id
        AND em.user_id = v_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.event_registration_submissions ers
      WHERE ers.event_id = v_event_id
        AND ers.user_id = v_user_id
    );

  IF NOT v_event_access THEN
    RETURN false;
  END IF;

  -- Standard attendee photo posts.
  IF v_folder = '' AND v_relative_path = v_filename AND v_owned_file THEN
    RETURN true;
  END IF;

  -- Member-owned chat, group, and vendor-logo images.
  IF v_folder IN ('chat', 'group-chat', 'vendor-logos')
    AND v_relative_path = v_folder || '/' || v_filename
    AND v_owned_file
  THEN
    RETURN true;
  END IF;

  -- Registration attachments remain event-scoped. Their original filenames
  -- are sanitized by the client and Storage enforces the bucket size limit.
  IF v_folder = 'vendor-attachments'
    AND v_relative_path = v_folder || '/' || v_filename
    AND v_filename <> ''
  THEN
    RETURN true;
  END IF;

  IF NOT v_event_admin THEN
    RETURN false;
  END IF;

  -- Event administrators can upload the configured event banner variants.
  IF v_folder = ''
    AND v_relative_path = v_filename
    AND lower(v_filename) ~ '^(banner|badge_banner|portal_banner)_[0-9]+\.(jpg|jpeg|png|webp)$'
  THEN
    RETURN true;
  END IF;

  -- Sponsor logos are admin-managed and still use a user-owned filename.
  RETURN v_folder = 'sponsor-logos'
    AND v_relative_path = v_folder || '/' || v_filename
    AND v_owned_file;
END;
$$;

REVOKE ALL ON FUNCTION private.can_upload_event_photo_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_upload_event_photo_object(text)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
CREATE POLICY "Event-scoped users can upload photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-photos'
  AND private.can_upload_event_photo_object(name)
);

