-- Vendor registration → Solution Provider booth profile sync.
-- Also ensure vendor forms collect description / logo / website by default.

CREATE OR REPLACE FUNCTION public.ensure_matchmaking_vendor_booth(p_submission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub public.event_registration_submissions%ROWTYPE;
  v_booth_id UUID;
  v_home_table TEXT;
  v_name TEXT;
  v_description TEXT;
  v_logo TEXT;
  v_website TEXT;
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

  -- Fields shown on Solution Provider in the app.
  v_description := NULLIF(trim(COALESCE(
    public.submission_answer_text(p_submission_id, 'company description'),
    ''
  )), '');
  v_logo := NULLIF(trim(COALESCE(
    public.submission_answer_text(p_submission_id, 'company logo'),
    ''
  )), '');
  v_website := NULLIF(trim(COALESCE(
    public.submission_answer_text(p_submission_id, 'company website'),
    ''
  )), '');

  SELECT loc.name
  INTO v_home_table
  FROM public.event_matchmaking_locations loc
  WHERE loc.event_id = v_sub.event_id
    AND loc.vendor_submission_id = v_sub.id
    AND loc.is_active IS DISTINCT FROM false
  ORDER BY loc.sort_order, loc.name
  LIMIT 1;

  SELECT vb.id INTO v_booth_id
  FROM public.vendor_booths vb
  WHERE vb.event_id = v_sub.event_id
    AND vb.registration_submission_id = v_sub.id
  LIMIT 1;

  IF v_booth_id IS NULL AND v_sub.user_id IS NOT NULL THEN
    SELECT vb.id INTO v_booth_id
    FROM public.vendor_booths vb
    WHERE vb.event_id = v_sub.event_id
      AND vb.contact_user_id = v_sub.user_id
    ORDER BY vb.created_at
    LIMIT 1;
  END IF;

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
      description,
      logo_url,
      website,
      contact_user_id,
      booth_location,
      registration_submission_id,
      is_active
    )
    VALUES (
      v_sub.event_id,
      v_name,
      v_description,
      v_logo,
      v_website,
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
      description = COALESCE(v_description, description),
      logo_url = COALESCE(v_logo, logo_url),
      website = COALESCE(v_website, website),
      is_active = true
    WHERE id = v_booth_id;
  END IF;

  IF v_sub.user_id IS NOT NULL THEN
    INSERT INTO public.vendor_booth_reps (booth_id, user_id)
    VALUES (v_booth_id, v_sub.user_id)
    ON CONFLICT (booth_id, user_id) DO NOTHING;
  END IF;

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
$function$;

COMMENT ON FUNCTION public.ensure_matchmaking_vendor_booth(uuid) IS
  'Creates/updates a Solution Provider booth for a matchmaking vendor, including description/logo/website from registration answers.';

-- Always ask vendors for Solution Provider app profile fields.
UPDATE public.event_registration_questions q
SET
  is_hidden = false,
  is_required = true,
  section_label = CASE
    WHEN q.section_label IS NULL
      OR trim(q.section_label) = ''
      OR lower(trim(q.section_label)) IN (
        'marketing profile',
        'marketing',
        'company information'
      )
    THEN 'Solution Provider profile (app)'
    ELSE q.section_label
  END
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'vendor'
  AND lower(trim(q.prompt)) IN (
    lower('Company Description'),
    lower('Company Logo Image'),
    lower('Company Logo'),
    lower('Company Website')
  );

DO $$
DECLARE
  r RECORD;
  v_sort INT;
BEGIN
  FOR r IN
    SELECT f.id AS form_id
    FROM public.event_registration_forms f
    WHERE f.audience = 'vendor'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.event_registration_questions q
      WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Company Description')
    ) THEN
      SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort
      FROM public.event_registration_questions WHERE form_id = r.form_id;
      INSERT INTO public.event_registration_questions (
        form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order
      ) VALUES (
        r.form_id, 'Company Description', 'textarea', true,
        'Solution Provider profile (app)', true, false, v_sort
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.event_registration_questions q
      WHERE q.form_id = r.form_id
        AND lower(trim(q.prompt)) IN (lower('Company Logo Image'), lower('Company Logo'))
    ) THEN
      SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort
      FROM public.event_registration_questions WHERE form_id = r.form_id;
      INSERT INTO public.event_registration_questions (
        form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order
      ) VALUES (
        r.form_id, 'Company Logo Image', 'text', true,
        'Solution Provider profile (app)', true, false, v_sort
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.event_registration_questions q
      WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Company Website')
    ) THEN
      SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort
      FROM public.event_registration_questions WHERE form_id = r.form_id;
      INSERT INTO public.event_registration_questions (
        form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order
      ) VALUES (
        r.form_id, 'Company Website', 'text', true,
        'Solution Provider profile (app)', true, false, v_sort
      );
    END IF;
  END LOOP;
END $$;
