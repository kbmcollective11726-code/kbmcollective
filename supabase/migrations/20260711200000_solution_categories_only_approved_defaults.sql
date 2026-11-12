-- Keep only the approved cross-vertical default solution categories.
DO $$
DECLARE
  v_keep TEXT[] := ARRAY[
    'Technology & Software',
    'Marketing & Communications',
    'Financial Services & Consulting',
    'Talent, HR & Workforce Solutions',
    'Sales & Customer Experience',
    'Legal, Risk & Compliance',
    'Operations & Supply Chain',
    'Leadership & Professional Development',
    'Sustainability & ESG',
    'Event & Meeting Services'
  ];
  v_event RECORD;
  v_i INT;
BEGIN
  DELETE FROM public.event_solution_categories
  WHERE category_name <> ALL (v_keep);

  FOR v_event IN
    SELECT DISTINCT event_id FROM (
      SELECT event_id FROM public.event_solution_categories
      UNION
      SELECT event_id FROM public.event_registration_forms
    ) s
  LOOP
    FOR v_i IN 1 .. array_length(v_keep, 1) LOOP
      INSERT INTO public.event_solution_categories (
        event_id, category_name, display_order, is_default, is_hidden
      )
      VALUES (v_event.event_id, v_keep[v_i], v_i - 1, true, false)
      ON CONFLICT (event_id, category_name) DO UPDATE
      SET display_order = EXCLUDED.display_order,
          is_default = true,
          is_hidden = false,
          updated_at = now();
    END LOOP;
  END LOOP;
END $$;
