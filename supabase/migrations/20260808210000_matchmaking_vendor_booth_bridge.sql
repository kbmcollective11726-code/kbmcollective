-- Bridge matchmaking vendors ↔ Solution Provider booths ↔ home tables.
-- Non-matchmaking events are unchanged (manual booths / Meetings only).

ALTER TABLE public.vendor_booths
  ADD COLUMN IF NOT EXISTS registration_submission_id UUID
    REFERENCES public.event_registration_submissions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_booths_event_registration_submission_uidx
  ON public.vendor_booths (event_id, registration_submission_id)
  WHERE registration_submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vendor_booths_registration_submission_id_idx
  ON public.vendor_booths (registration_submission_id)
  WHERE registration_submission_id IS NOT NULL;

ALTER TABLE public.event_matchmaking_locations
  ADD COLUMN IF NOT EXISTS vendor_booth_id UUID
    REFERENCES public.vendor_booths(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_matchmaking_locations_vendor_booth_id_idx
  ON public.event_matchmaking_locations (vendor_booth_id)
  WHERE vendor_booth_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.event_uses_matchmaking(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND (
        e.admin_console_tiles IS NULL
        OR 'matchmaking' = ANY (e.admin_console_tiles)
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.event_matchmaking_settings s WHERE s.event_id = p_event_id
  );
$$;

REVOKE ALL ON FUNCTION public.event_uses_matchmaking(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_uses_matchmaking(UUID) TO authenticated, anon, service_role;

/**
 * Ensure a Solution Provider booth exists for a matchmaking vendor submission.
 * Safe no-op when the event is not using matchmaking or the submission is not a vendor.
 */
CREATE OR REPLACE FUNCTION public.ensure_matchmaking_vendor_booth(p_submission_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.event_registration_submissions%ROWTYPE;
  v_booth_id UUID;
  v_home_table TEXT;
  v_name TEXT;
BEGIN
  IF p_submission_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_sub
  FROM public.event_registration_submissions
  WHERE id = p_submission_id;

  IF v_sub.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_sub.attendee_type IS DISTINCT FROM 'vendor' THEN
    RETURN NULL;
  END IF;
  IF v_sub.meetings_enabled IS FALSE THEN
    RETURN NULL;
  END IF;
  IF v_sub.matching_opt_in IS FALSE THEN
    RETURN NULL;
  END IF;
  IF v_sub.registration_status = 'rejected' THEN
    RETURN NULL;
  END IF;
  IF NOT public.event_uses_matchmaking(v_sub.event_id) THEN
    RETURN NULL;
  END IF;

  v_name := NULLIF(trim(COALESCE(v_sub.company_name, '')), '');
  IF v_name IS NULL THEN
    v_name := NULLIF(
      trim(concat_ws(' ', v_sub.first_name, v_sub.last_name)),
      ''
    );
  END IF;
  IF v_name IS NULL THEN
    v_name := 'Vendor';
  END IF;

  SELECT loc.name
  INTO v_home_table
  FROM public.event_matchmaking_locations loc
  WHERE loc.event_id = v_sub.event_id
    AND loc.vendor_submission_id = v_sub.id
    AND loc.is_active IS DISTINCT FROM false
  ORDER BY loc.sort_order, loc.name
  LIMIT 1;

  -- 1) Exact registration link
  SELECT vb.id INTO v_booth_id
  FROM public.vendor_booths vb
  WHERE vb.event_id = v_sub.event_id
    AND vb.registration_submission_id = v_sub.id
  LIMIT 1;

  -- 2) Same contact user
  IF v_booth_id IS NULL AND v_sub.user_id IS NOT NULL THEN
    SELECT vb.id INTO v_booth_id
    FROM public.vendor_booths vb
    WHERE vb.event_id = v_sub.event_id
      AND vb.contact_user_id = v_sub.user_id
    ORDER BY vb.created_at
    LIMIT 1;
  END IF;

  -- 3) Same company name (case-insensitive)
  IF v_booth_id IS NULL THEN
    SELECT vb.id INTO v_booth_id
    FROM public.vendor_booths vb
    WHERE vb.event_id = v_sub.event_id
      AND vb.vendor_name ILIKE v_name
    ORDER BY vb.created_at
    LIMIT 1;
  END IF;

  IF v_booth_id IS NULL THEN
    INSERT INTO public.vendor_booths (
      event_id,
      vendor_name,
      contact_user_id,
      booth_location,
      registration_submission_id,
      is_active
    )
    VALUES (
      v_sub.event_id,
      v_name,
      v_sub.user_id,
      v_home_table,
      v_sub.id,
      true
    )
    RETURNING id INTO v_booth_id;
  ELSE
    UPDATE public.vendor_booths
    SET
      vendor_name = COALESCE(NULLIF(trim(vendor_name), ''), v_name),
      contact_user_id = COALESCE(contact_user_id, v_sub.user_id),
      registration_submission_id = COALESCE(registration_submission_id, v_sub.id),
      booth_location = COALESCE(NULLIF(trim(booth_location), ''), v_home_table),
      is_active = true
    WHERE id = v_booth_id;
  END IF;

  IF v_sub.user_id IS NOT NULL THEN
    INSERT INTO public.vendor_booth_reps (booth_id, user_id)
    VALUES (v_booth_id, v_sub.user_id)
    ON CONFLICT (booth_id, user_id) DO NOTHING;
  END IF;

  -- Keep home-table ↔ booth link in sync when a table is already assigned.
  UPDATE public.event_matchmaking_locations loc
  SET vendor_booth_id = v_booth_id,
      updated_at = now()
  WHERE loc.event_id = v_sub.event_id
    AND loc.vendor_submission_id = v_sub.id
    AND (loc.vendor_booth_id IS DISTINCT FROM v_booth_id);

  IF v_home_table IS NOT NULL THEN
    UPDATE public.vendor_booths
    SET booth_location = v_home_table
    WHERE id = v_booth_id
      AND COALESCE(NULLIF(trim(booth_location), ''), '') = '';
  END IF;

  RETURN v_booth_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_matchmaking_vendor_booth(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_matchmaking_vendor_booth(UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_ensure_matchmaking_vendor_booth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.attendee_type IS DISTINCT FROM 'vendor' THEN
    RETURN NEW;
  END IF;
  -- Create/update booth once the vendor is in the pool (approved, or submitted with a linked account).
  IF NEW.registration_status = 'approved'
     OR (NEW.status = 'submitted' AND NEW.user_id IS NOT NULL AND COALESCE(NEW.registration_status, 'pending_review') <> 'rejected')
  THEN
    PERFORM public.ensure_matchmaking_vendor_booth(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_registration_submissions_ensure_vendor_booth
  ON public.event_registration_submissions;
CREATE TRIGGER event_registration_submissions_ensure_vendor_booth
  AFTER INSERT OR UPDATE OF registration_status, status, user_id, company_name, meetings_enabled, matching_opt_in, attendee_type
  ON public.event_registration_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ensure_matchmaking_vendor_booth();

CREATE OR REPLACE FUNCTION public.trg_sync_location_vendor_booth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booth_id UUID;
BEGIN
  IF NEW.vendor_submission_id IS NULL THEN
    IF NEW.vendor_booth_id IS NOT NULL THEN
      NEW.vendor_booth_id := NULL;
    END IF;
    RETURN NEW;
  END IF;

  v_booth_id := public.ensure_matchmaking_vendor_booth(NEW.vendor_submission_id);
  NEW.vendor_booth_id := v_booth_id;

  IF v_booth_id IS NOT NULL AND NEW.name IS NOT NULL THEN
    UPDATE public.vendor_booths
    SET booth_location = NEW.name
    WHERE id = v_booth_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_matchmaking_locations_sync_vendor_booth
  ON public.event_matchmaking_locations;
CREATE TRIGGER event_matchmaking_locations_sync_vendor_booth
  BEFORE INSERT OR UPDATE OF vendor_submission_id, name
  ON public.event_matchmaking_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_location_vendor_booth();

-- Prefer registration-linked / home-table booth when publishing to Meetings / app.
CREATE OR REPLACE FUNCTION public.publish_matchmaking_meeting_to_app(p_meeting_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m public.event_match_scheduled_meetings%ROWTYPE;
  v_delegate_user UUID;
  v_vendor_sub UUID;
  v_vendor_user UUID;
  v_booth_id UUID;
  v_slot_id UUID;
  v_booking_id UUID;
  v_table_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_m
  FROM public.event_match_scheduled_meetings
  WHERE id = p_meeting_id
  FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'Meeting not found'; END IF;
  IF NOT (
    public.is_event_admin(v_m.event_id)
    OR public.is_platform_admin(auth.uid())
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_m.status <> 'scheduled' THEN RAISE EXCEPTION 'Meeting is not active'; END IF;

  IF v_m.app_booking_id IS NOT NULL THEN
    SELECT b.id, b.slot_id
    INTO v_booking_id, v_slot_id
    FROM public.meeting_bookings b
    WHERE b.id = v_m.app_booking_id;
    IF v_booking_id IS NOT NULL THEN
      UPDATE public.meeting_slots
      SET start_time = v_m.start_time,
          end_time = v_m.end_time,
          is_available = false
      WHERE id = v_slot_id;
      UPDATE public.meeting_bookings
      SET status = 'confirmed',
          notes = COALESCE('Matchmaking: ' || v_m.location, 'Matchmaking meeting')
      WHERE id = v_booking_id;
      UPDATE public.event_match_scheduled_meetings
      SET published_to_app_at = now(), updated_at = now()
      WHERE id = v_m.id;
      RETURN v_booking_id;
    END IF;
  END IF;

  SELECT s.user_id INTO v_delegate_user
  FROM public.event_registration_submissions s
  WHERE s.id IN (v_m.submission_a_id, v_m.submission_b_id)
    AND s.attendee_type = 'attendee'
  LIMIT 1;
  SELECT s.id, s.user_id INTO v_vendor_sub, v_vendor_user
  FROM public.event_registration_submissions s
  WHERE s.id IN (v_m.submission_a_id, v_m.submission_b_id)
    AND s.attendee_type = 'vendor'
  LIMIT 1;
  IF v_delegate_user IS NULL OR v_vendor_user IS NULL THEN
    RAISE EXCEPTION 'Linked delegate and vendor accounts are required';
  END IF;

  -- Prefer booth already linked to this vendor registration / home table.
  v_booth_id := public.ensure_matchmaking_vendor_booth(v_vendor_sub);

  IF v_booth_id IS NULL AND v_m.location_id IS NOT NULL THEN
    SELECT loc.vendor_booth_id, loc.name
    INTO v_booth_id, v_table_name
    FROM public.event_matchmaking_locations loc
    WHERE loc.id = v_m.location_id;
  END IF;

  IF v_booth_id IS NULL THEN
    SELECT vb.id INTO v_booth_id
    FROM public.vendor_booths vb
    WHERE vb.event_id = v_m.event_id
      AND (
        vb.registration_submission_id = v_vendor_sub
        OR vb.contact_user_id = v_vendor_user
        OR vb.vendor_name ILIKE (
          SELECT company_name
          FROM public.event_registration_submissions
          WHERE id = v_vendor_sub
        )
      )
    ORDER BY
      CASE WHEN vb.registration_submission_id = v_vendor_sub THEN 0 ELSE 1 END,
      vb.created_at
    LIMIT 1;
  END IF;

  IF v_booth_id IS NULL THEN
    INSERT INTO public.vendor_booths (
      event_id, vendor_name, contact_user_id, booth_location, registration_submission_id, is_active
    )
    SELECT
      v_m.event_id,
      COALESCE(s.company_name, 'Vendor'),
      v_vendor_user,
      COALESCE(v_table_name, v_m.location),
      v_vendor_sub,
      true
    FROM public.event_registration_submissions s
    WHERE s.id = v_vendor_sub
    RETURNING id INTO v_booth_id;
  END IF;

  IF v_m.location IS NOT NULL THEN
    UPDATE public.vendor_booths
    SET booth_location = COALESCE(NULLIF(trim(booth_location), ''), v_m.location)
    WHERE id = v_booth_id;
  END IF;

  INSERT INTO public.meeting_slots (booth_id, start_time, end_time, is_available)
  VALUES (v_booth_id, v_m.start_time, v_m.end_time, false)
  RETURNING id INTO v_slot_id;
  INSERT INTO public.meeting_bookings (slot_id, attendee_id, status, notes)
  VALUES (
    v_slot_id,
    v_delegate_user,
    'confirmed',
    COALESCE('Matchmaking: ' || v_m.location, 'Matchmaking meeting')
  )
  RETURNING id INTO v_booking_id;

  UPDATE public.event_match_scheduled_meetings
  SET published_to_app_at = now(),
      app_booking_id = v_booking_id,
      updated_at = now()
  WHERE id = v_m.id;

  RETURN v_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_matchmaking_meeting_to_app(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_matchmaking_meeting_to_app(UUID)
  TO authenticated, service_role;

-- Backfill existing matchmaking vendors + home-table links.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT s.id
    FROM public.event_registration_submissions s
    WHERE s.attendee_type = 'vendor'
      AND COALESCE(s.registration_status, 'pending_review') <> 'rejected'
      AND s.meetings_enabled IS DISTINCT FROM false
      AND s.matching_opt_in IS DISTINCT FROM false
      AND public.event_uses_matchmaking(s.event_id)
  LOOP
    PERFORM public.ensure_matchmaking_vendor_booth(r.id);
  END LOOP;

  UPDATE public.event_matchmaking_locations loc
  SET vendor_booth_id = vb.id,
      updated_at = now()
  FROM public.vendor_booths vb
  WHERE loc.vendor_submission_id IS NOT NULL
    AND vb.registration_submission_id = loc.vendor_submission_id
    AND loc.vendor_booth_id IS DISTINCT FROM vb.id;
END;
$$;
