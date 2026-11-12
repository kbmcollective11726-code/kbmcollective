-- Each registration form owns its own solution category checklist.

ALTER TABLE public.event_solution_categories
  ADD COLUMN IF NOT EXISTS form_id UUID REFERENCES public.event_registration_forms(id) ON DELETE CASCADE;

WITH ranked_forms AS (
  SELECT
    id,
    event_id,
    audience,
    ROW_NUMBER() OVER (
      PARTITION BY event_id,
      CASE WHEN audience = 'vendor' THEN 'vendor' ELSE 'attendee' END
      ORDER BY sort_order ASC, created_at ASC
    ) AS rn
  FROM public.event_registration_forms
  WHERE audience IN ('attendee', 'vendor')
),
primary_forms AS (
  SELECT id, event_id, audience
  FROM ranked_forms
  WHERE rn = 1
)
UPDATE public.event_solution_categories c
SET form_id = pf.id
FROM primary_forms pf
WHERE c.form_id IS NULL
  AND c.event_id = pf.event_id
  AND c.audience = CASE WHEN pf.audience = 'vendor' THEN 'vendor' ELSE 'attendee' END;

DELETE FROM public.event_solution_categories
WHERE form_id IS NULL;

ALTER TABLE public.event_solution_categories
  ALTER COLUMN form_id SET NOT NULL;

ALTER TABLE public.event_solution_categories
  DROP CONSTRAINT IF EXISTS event_solution_categories_event_audience_name_unique;

ALTER TABLE public.event_solution_categories
  DROP CONSTRAINT IF EXISTS event_solution_categories_form_name_unique;

ALTER TABLE public.event_solution_categories
  ADD CONSTRAINT event_solution_categories_form_name_unique
  UNIQUE (form_id, category_name);

CREATE INDEX IF NOT EXISTS idx_event_solution_categories_form
  ON public.event_solution_categories (form_id, display_order);

COMMENT ON COLUMN public.event_solution_categories.form_id IS
  'Each registration form has its own category checklist. Duplicate form or Copy from delegate syncs rows between forms.';

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
  v_audience TEXT;
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

  v_audience := CASE
    WHEN v_sub.attendee_type = 'vendor' THEN 'vendor'
    ELSE 'attendee'
  END;

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
      WHERE form_id = v_sub.form_id
        AND lower(trim(category_name)) = lower(v_label)
      LIMIT 1;

      IF v_cat_id IS NULL THEN
        INSERT INTO public.event_solution_categories (event_id, form_id, category_name, display_order, audience)
        VALUES (
          v_sub.event_id,
          v_sub.form_id,
          v_label,
          COALESCE(
            (SELECT MAX(display_order) + 1
             FROM public.event_solution_categories
             WHERE form_id = v_sub.form_id),
            0
          ),
          v_audience
        )
        ON CONFLICT (form_id, category_name) DO UPDATE SET updated_at = now()
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

REVOKE ALL ON FUNCTION public.sync_submission_solution_categories(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_submission_solution_categories(UUID) TO authenticated, service_role;
