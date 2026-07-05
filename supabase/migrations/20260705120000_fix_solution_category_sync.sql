-- Only sync solution-category multi_select answers (not Meeting Goals or other multi_select fields).
-- Remove meeting-goal labels that were incorrectly auto-seeded as solution categories.

CREATE OR REPLACE FUNCTION public.sync_submission_solution_categories(p_submission_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub public.event_registration_submissions%ROWTYPE;
  v_cat_id UUID;
  v_label TEXT;
  v_linked INT := 0;
  v_answer RECORD;
BEGIN
  SELECT * INTO v_sub FROM public.event_registration_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF NOT (
    public.is_platform_admin((SELECT auth.uid()))
    OR public.is_event_admin(v_sub.event_id)
    OR v_sub.user_id = (SELECT auth.uid())
    OR public.registration_submission_owned_by_auth(p_submission_id)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM public.event_registration_solution_categories WHERE submission_id = p_submission_id;

  FOR v_answer IN
    SELECT q.question_type, a.answer_json
    FROM public.event_registration_answers a
    JOIN public.event_registration_questions q ON q.id = a.question_id
    WHERE a.submission_id = p_submission_id
      AND q.question_type = 'multi_select'
      AND a.answer_json IS NOT NULL
      AND jsonb_typeof(a.answer_json) = 'array'
      AND lower(trim(q.prompt)) IN (
        lower('Solution Category of Interest'),
        lower('Solution/Vendor Category You Offer')
      )
  LOOP
    FOR v_label IN SELECT jsonb_array_elements_text(v_answer.answer_json)
    LOOP
      v_label := trim(v_label);
      IF v_label = '' OR lower(v_label) = 'n/a' THEN CONTINUE; END IF;

      SELECT id INTO v_cat_id
      FROM public.event_solution_categories
      WHERE event_id = v_sub.event_id
        AND lower(trim(category_name)) = lower(v_label)
      LIMIT 1;

      IF v_cat_id IS NULL THEN
        INSERT INTO public.event_solution_categories (event_id, category_name, display_order)
        VALUES (
          v_sub.event_id,
          v_label,
          COALESCE((SELECT MAX(display_order) + 1 FROM public.event_solution_categories WHERE event_id = v_sub.event_id), 0)
        )
        ON CONFLICT (event_id, category_name) DO UPDATE SET updated_at = now()
        RETURNING id INTO v_cat_id;
      END IF;

      INSERT INTO public.event_registration_solution_categories (submission_id, category_id)
      VALUES (p_submission_id, v_cat_id)
      ON CONFLICT DO NOTHING;

      v_linked := v_linked + 1;
    END LOOP;
  END LOOP;

  RETURN v_linked;
END;
$$;

-- Clean up meeting-goal labels mistakenly stored as solution categories.
DELETE FROM public.event_solution_categories
WHERE lower(trim(category_name)) IN (
  lower('Evaluating solutions to purchase in the next 6 months'),
  lower('Researching for a future budget cycle'),
  lower('Open to learning about new vendors'),
  lower('Exploring strategic partnerships'),
  lower('Networking / relationship-building only'),
  lower('Sharing my organization''s expertise'),
  lower('Other'),
  lower('Generate new leads'),
  lower('Deepen existing relationships'),
  lower('Brand awareness'),
  lower('Recruit partners')
);
