-- KBM Connect matchmaking rebuild: solution categories, stage-2 gates, match config, publish bridge.

-- ---------------------------------------------------------------------------
-- Settings: per-role Stage 2 activation + holding copy
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_matchmaking_settings
  ADD COLUMN IF NOT EXISTS delegate_stage2_active BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vendor_stage2_active BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stage2_holding_message TEXT;

COMMENT ON COLUMN public.event_matchmaking_settings.delegate_stage2_active IS
  'When true, delegates can complete Stage 2 profile in the portal.';
COMMENT ON COLUMN public.event_matchmaking_settings.vendor_stage2_active IS
  'When true, vendors can complete Stage 2 profile in the portal.';

-- ---------------------------------------------------------------------------
-- Submissions: profile gate + matching pool fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_registration_submissions
  ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration_status TEXT NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS matching_opt_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meeting_availability JSONB,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

ALTER TABLE public.event_registration_submissions
  DROP CONSTRAINT IF EXISTS event_registration_submissions_registration_status_check;

ALTER TABLE public.event_registration_submissions
  ADD CONSTRAINT event_registration_submissions_registration_status_check
  CHECK (registration_status IN ('pending_review', 'approved', 'rejected'));

-- Backfill: submitted registrations count as approved for existing events
UPDATE public.event_registration_submissions
SET registration_status = 'approved', profile_complete = true
WHERE status = 'submitted' AND registration_status = 'pending_review';

-- ---------------------------------------------------------------------------
-- Questions: matching toggle
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_registration_questions
  ADD COLUMN IF NOT EXISTS used_in_matching BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Solution categories (shared delegate interest + vendor offer)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_solution_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_solution_categories_name_unique UNIQUE (event_id, category_name)
);

CREATE INDEX IF NOT EXISTS idx_event_solution_categories_event
  ON public.event_solution_categories(event_id, display_order);

CREATE TABLE IF NOT EXISTS public.event_registration_solution_categories (
  submission_id UUID NOT NULL REFERENCES public.event_registration_submissions(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.event_solution_categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_event_reg_solution_cats_submission
  ON public.event_registration_solution_categories(submission_id);

ALTER TABLE public.event_solution_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registration_solution_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_solution_categories_select_perm" ON public.event_solution_categories;
CREATE POLICY "event_solution_categories_select_perm" ON public.event_solution_categories
  FOR SELECT TO public
  USING (
    public.is_event_admin(event_id)
    OR public.is_platform_admin((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.event_matchmaking_settings s
      WHERE s.event_id = event_solution_categories.event_id
        AND (s.registration_open OR s.delegate_stage2_active OR s.vendor_stage2_active)
    )
  );

DROP POLICY IF EXISTS "event_solution_categories_admin" ON public.event_solution_categories;
CREATE POLICY "event_solution_categories_admin" ON public.event_solution_categories
  FOR ALL TO public
  USING (public.is_event_admin(event_id) OR public.is_platform_admin((SELECT auth.uid())))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "event_reg_solution_cats_select" ON public.event_registration_solution_categories;
CREATE POLICY "event_reg_solution_cats_select" ON public.event_registration_solution_categories
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.event_registration_submissions s
      WHERE s.id = event_registration_solution_categories.submission_id
        AND (
          public.is_platform_admin((SELECT auth.uid()))
          OR public.is_event_admin(s.event_id)
          OR s.user_id = (SELECT auth.uid())
          OR public.registration_submission_owned_by_auth(s.id)
        )
    )
  );

DROP POLICY IF EXISTS "event_reg_solution_cats_manage" ON public.event_registration_solution_categories;
CREATE POLICY "event_reg_solution_cats_manage" ON public.event_registration_solution_categories
  FOR ALL TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.event_registration_submissions s
      WHERE s.id = event_registration_solution_categories.submission_id
        AND (
          public.is_platform_admin((SELECT auth.uid()))
          OR public.is_event_admin(s.event_id)
          OR s.user_id = (SELECT auth.uid())
          OR public.registration_submission_owned_by_auth(s.id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.event_registration_submissions s
      WHERE s.id = event_registration_solution_categories.submission_id
        AND (
          public.is_platform_admin((SELECT auth.uid()))
          OR public.is_event_admin(s.event_id)
          OR s.user_id = (SELECT auth.uid())
          OR public.registration_submission_owned_by_auth(s.id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Per-event match scoring weights
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_match_config (
  event_id UUID PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  weight_category INT NOT NULL DEFAULT 40 CHECK (weight_category >= 0),
  weight_goals INT NOT NULL DEFAULT 15 CHECK (weight_goals >= 0),
  weight_seniority INT NOT NULL DEFAULT 10 CHECK (weight_seniority >= 0),
  weight_revenue INT NOT NULL DEFAULT 10 CHECK (weight_revenue >= 0),
  weight_budget INT NOT NULL DEFAULT 10 CHECK (weight_budget >= 0),
  weight_scope INT NOT NULL DEFAULT 10 CHECK (weight_scope >= 0),
  weight_semantic INT NOT NULL DEFAULT 5 CHECK (weight_semantic >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.event_match_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_match_config_admin" ON public.event_match_config;
CREATE POLICY "event_match_config_admin" ON public.event_match_config
  FOR ALL TO public
  USING (public.is_event_admin(event_id) OR public.is_platform_admin((SELECT auth.uid())))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin((SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- Scheduled meetings: publish bridge to app tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_match_scheduled_meetings
  ADD COLUMN IF NOT EXISTS published_to_app_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS app_booking_id UUID REFERENCES public.meeting_bookings(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Vendor portal helpers (mirror delegate)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_submitted_vendor_registration(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_registration_submissions s
    LEFT JOIN public.users u ON u.id = auth.uid()
    WHERE s.event_id = p_event_id
      AND s.attendee_type = 'vendor'
      AND s.status = 'submitted'
      AND s.registration_status <> 'rejected'
      AND (
        s.user_id = auth.uid()
        OR (
          s.email IS NOT NULL
          AND u.email IS NOT NULL
          AND lower(trim(s.email)) = lower(trim(u.email))
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_submitted_vendor_registration(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_submitted_vendor_registration(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.link_my_vendor_submission(p_event_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_submission_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT u.email INTO v_email FROM public.users u WHERE u.id = auth.uid();
  IF v_email IS NULL OR trim(v_email) = '' THEN RETURN NULL; END IF;

  UPDATE public.event_registration_submissions s
  SET user_id = auth.uid(), updated_at = now()
  WHERE s.event_id = p_event_id
    AND s.attendee_type = 'vendor'
    AND s.status = 'submitted'
    AND s.user_id IS NULL
    AND lower(trim(s.email)) = lower(trim(v_email))
  RETURNING s.id INTO v_submission_id;

  IF v_submission_id IS NOT NULL THEN RETURN v_submission_id; END IF;

  SELECT s.id INTO v_submission_id
  FROM public.event_registration_submissions s
  WHERE s.event_id = p_event_id
    AND s.attendee_type = 'vendor'
    AND s.status = 'submitted'
    AND s.user_id = auth.uid()
  ORDER BY s.submitted_at DESC NULLS LAST, s.created_at DESC
  LIMIT 1;

  RETURN v_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_my_vendor_submission(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_my_vendor_submission(UUID) TO authenticated, service_role;

-- Stage 2 active check per audience
CREATE OR REPLACE FUNCTION public.is_stage2_active_for_audience(p_event_id UUID, p_audience TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_audience IN ('attendee', 'delegate') THEN COALESCE(
      (SELECT s.delegate_stage2_active FROM public.event_matchmaking_settings s WHERE s.event_id = p_event_id),
      false
    )
    WHEN p_audience = 'vendor' THEN COALESCE(
      (SELECT s.vendor_stage2_active FROM public.event_matchmaking_settings s WHERE s.event_id = p_event_id),
      false
    )
    ELSE COALESCE(
      (SELECT s.delegate_stage2_active FROM public.event_matchmaking_settings s WHERE s.event_id = p_event_id),
      false
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_stage2_active_for_audience(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_stage2_active_for_audience(UUID, TEXT) TO anon, authenticated, service_role;

-- Extend public settings read for vendors
DROP POLICY IF EXISTS "event_matchmaking_settings_select_perm" ON public.event_matchmaking_settings;
DROP POLICY IF EXISTS "Public read open matchmaking settings" ON public.event_matchmaking_settings;
DROP POLICY IF EXISTS "event_matchmaking_settings_public_read" ON public.event_matchmaking_settings;

CREATE POLICY "event_matchmaking_settings_public_read" ON public.event_matchmaking_settings
  FOR SELECT TO public
  USING (
    registration_open = true
    OR delegate_stage2_active = true
    OR vendor_stage2_active = true
    OR public.is_event_admin(event_id)
    OR public.is_platform_admin((SELECT auth.uid()))
    OR public.has_submitted_delegate_registration(event_id)
    OR public.has_submitted_vendor_registration(event_id)
  );

-- ---------------------------------------------------------------------------
-- Structured match scoring (v1) — server-side for consistency
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_match_score(
  p_event_id UUID,
  p_from_submission_id UUID,
  p_to_submission_id UUID
)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat_overlap INT := 0;
  v_cfg RECORD;
  v_total INT := 0;
BEGIN
  SELECT * INTO v_cfg FROM public.event_match_config WHERE event_id = p_event_id;
  IF NOT FOUND THEN
    v_cfg.weight_category := 40;
    v_cfg.weight_goals := 15;
    v_cfg.weight_seniority := 10;
    v_cfg.weight_revenue := 10;
    v_cfg.weight_budget := 10;
    v_cfg.weight_scope := 10;
  END IF;

  SELECT COUNT(*)::INT INTO v_cat_overlap
  FROM public.event_registration_solution_categories a
  JOIN public.event_registration_solution_categories b
    ON b.category_id = a.category_id
  WHERE a.submission_id = p_from_submission_id
    AND b.submission_id = p_to_submission_id;

  v_total := LEAST(v_cfg.weight_category, v_cat_overlap * 10);

  -- Interest request company name boost
  IF EXISTS (
    SELECT 1
    FROM public.event_meeting_interest_requests r
    JOIN public.event_registration_submissions cand ON cand.id = p_to_submission_id
    WHERE r.submission_id = p_from_submission_id
      AND lower(trim(COALESCE(r.target_company_name, ''))) = lower(trim(COALESCE(cand.company_name, '')))
      AND trim(COALESCE(r.target_company_name, '')) <> ''
  ) THEN
    v_total := v_total + 20;
  END IF;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_match_score(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_match_score(UUID, UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generate_event_match_suggestions(p_event_id UUID, p_limit INT DEFAULT 200)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delegate RECORD;
  v_vendor RECORD;
  v_score INT;
  v_inserted INT := 0;
BEGIN
  IF NOT (public.is_event_admin(p_event_id) OR public.is_platform_admin((SELECT auth.uid()))) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  FOR v_delegate IN
    SELECT id FROM public.event_registration_submissions
    WHERE event_id = p_event_id
      AND attendee_type = 'attendee'
      AND status = 'submitted'
      AND registration_status = 'approved'
      AND profile_complete = true
      AND matching_opt_in = true
      AND rejected_at IS NULL
  LOOP
    FOR v_vendor IN
      SELECT id FROM public.event_registration_submissions
      WHERE event_id = p_event_id
        AND attendee_type = 'vendor'
        AND status = 'submitted'
        AND registration_status = 'approved'
        AND profile_complete = true
        AND matching_opt_in = true
        AND rejected_at IS NULL
    LOOP
      v_score := public.compute_match_score(p_event_id, v_delegate.id, v_vendor.id);
      IF v_score <= 0 THEN CONTINUE; END IF;

      INSERT INTO public.event_match_reviews (
        event_id, from_submission_id, to_submission_id, score, status
      ) VALUES (
        p_event_id, v_delegate.id, v_vendor.id, v_score, 'pending'
      )
      ON CONFLICT (event_id, from_submission_id, to_submission_id)
      DO UPDATE SET score = EXCLUDED.score, updated_at = now()
      WHERE event_match_reviews.status = 'pending';

      v_inserted := v_inserted + 1;
      EXIT WHEN v_inserted >= p_limit;
    END LOOP;
    EXIT WHEN v_inserted >= p_limit;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_event_match_suggestions(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_event_match_suggestions(UUID, INT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Publish approved matchmaking meeting into app meeting tables (gated, explicit)
-- ---------------------------------------------------------------------------
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
BEGIN
  SELECT * INTO v_m FROM public.event_match_scheduled_meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'meeting not found'; END IF;
  IF NOT (public.is_event_admin(v_m.event_id) OR public.is_platform_admin((SELECT auth.uid()))) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF v_m.status <> 'scheduled' THEN RAISE EXCEPTION 'meeting not schedulable'; END IF;
  IF v_m.published_to_app_at IS NOT NULL AND v_m.app_booking_id IS NOT NULL THEN
    RETURN v_m.app_booking_id;
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
    RAISE EXCEPTION 'delegate and vendor submissions with linked users required';
  END IF;

  SELECT vb.id INTO v_booth_id
  FROM public.vendor_booths vb
  WHERE vb.event_id = v_m.event_id
    AND (vb.contact_user_id = v_vendor_user OR vb.vendor_name ILIKE (
      SELECT company_name FROM public.event_registration_submissions WHERE id = v_vendor_sub
    ))
  ORDER BY vb.created_at
  LIMIT 1;

  IF v_booth_id IS NULL THEN
    INSERT INTO public.vendor_booths (event_id, vendor_name, contact_user_id, is_active)
    SELECT v_m.event_id, COALESCE(s.company_name, 'Vendor'), v_vendor_user, true
    FROM public.event_registration_submissions s WHERE s.id = v_vendor_sub
    RETURNING id INTO v_booth_id;
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
  SET published_to_app_at = now(), app_booking_id = v_booking_id, updated_at = now()
  WHERE id = p_meeting_id;

  RETURN v_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_matchmaking_meeting_to_app(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_matchmaking_meeting_to_app(UUID) TO authenticated, service_role;
