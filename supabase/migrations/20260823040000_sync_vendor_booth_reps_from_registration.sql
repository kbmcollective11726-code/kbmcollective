-- Sync form completer + additional onsite representatives into vendor_booth_reps.
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
  v_rep_email TEXT;
  v_rep_user_id UUID;
  v_rep RECORD;
  v_reps_json JSONB;
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
    v_name := NULLIF(trim(concat_ws(' ', v_sub.first_name, v_sub.last_name)), '');
  END IF;
  IF v_name IS NULL THEN
    v_name := 'Vendor';
  END IF;

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
      contact_user_id = COALESCE(v_sub.user_id, contact_user_id),
      registration_submission_id = COALESCE(registration_submission_id, v_sub.id),
      booth_location = COALESCE(NULLIF(trim(booth_location), ''), v_home_table),
      description = COALESCE(v_description, description),
      logo_url = COALESCE(v_logo, logo_url),
      website = COALESCE(v_website, website),
      is_active = true
    WHERE id = v_booth_id;
  END IF;

  -- Form completer is always primary contact + booth rep.
  IF v_sub.user_id IS NOT NULL THEN
    UPDATE public.vendor_booths
    SET contact_user_id = v_sub.user_id
    WHERE id = v_booth_id
      AND contact_user_id IS DISTINCT FROM v_sub.user_id;

    INSERT INTO public.vendor_booth_reps (booth_id, user_id)
    VALUES (v_booth_id, v_sub.user_id)
    ON CONFLICT (booth_id, user_id) DO NOTHING;
  END IF;

  -- Additional onsite representatives from logistics answer_json → booth reps when they already have users.
  SELECT a.answer_json -> 'representatives'
  INTO v_reps_json
  FROM public.event_registration_answers a
  JOIN public.event_registration_questions q ON q.id = a.question_id
  WHERE a.submission_id = p_submission_id
    AND lower(trim(q.prompt)) LIKE '%sending representatives%'
    AND a.answer_json IS NOT NULL
  ORDER BY q.sort_order
  LIMIT 1;

  IF v_reps_json IS NOT NULL AND jsonb_typeof(v_reps_json) = 'array' THEN
    FOR v_rep IN
      SELECT value AS item
      FROM jsonb_array_elements(v_reps_json) AS t(value)
    LOOP
      v_rep_email := lower(trim(COALESCE(
        v_rep.item ->> 'email',
        v_rep.item ->> 'Email',
        ''
      )));
      IF v_rep_email = '' OR position('@' IN v_rep_email) = 0 THEN
        CONTINUE;
      END IF;

      SELECT u.id INTO v_rep_user_id
      FROM public.users u
      WHERE lower(trim(u.email)) = v_rep_email
      LIMIT 1;

      IF v_rep_user_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.vendor_booth_reps (booth_id, user_id)
      VALUES (v_booth_id, v_rep_user_id)
      ON CONFLICT (booth_id, user_id) DO NOTHING;

      UPDATE public.users u
      SET
        title = COALESCE(
          NULLIF(trim(u.title), ''),
          NULLIF(trim(COALESCE(v_rep.item ->> 'title', v_rep.item ->> 'Title', '')), '')
        ),
        company = COALESCE(
          NULLIF(trim(u.company), ''),
          NULLIF(trim(COALESCE(v_sub.company_name, '')), '')
        ),
        full_name = COALESCE(
          NULLIF(trim(u.full_name), ''),
          NULLIF(trim(concat_ws(
            ' ',
            COALESCE(v_rep.item ->> 'firstName', v_rep.item ->> 'first_name', ''),
            COALESCE(v_rep.item ->> 'lastName', v_rep.item ->> 'last_name', '')
          )), '')
        )
      WHERE u.id = v_rep_user_id;
    END LOOP;
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
