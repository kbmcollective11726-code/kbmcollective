-- Sync all events: hide legacy C-suite Yes/No, ensure Seniority Level + Meeting Goals,
-- align vendor hoped-seniority options, mark solution-interest matching flags.
-- Companion to 20260711193000 / 20260711194500 / 20260711195000.

DO $$
DECLARE
  v_form RECORD;
  v_q RECORD;
  v_sort INT;
  v_qid UUID;
  v_seniority_prompt TEXT := 'Seniority Level';
  v_seniority_options TEXT[] := ARRAY[
    'C-Suite',
    'SVP/VP',
    'Director',
    'Manager',
    'Individual Contributor'
  ];
  v_meeting_goals_prompt TEXT := 'Meeting Goals';
  v_meeting_goals_help TEXT :=
    'Select the option that best describes what you want from 1:1 meetings at this event.';
  v_meeting_goals_options TEXT[] := ARRAY[
    'I want to explore solutions relevant to my work',
    'I want to understand how others are solving similar challenges',
    'I want to evaluate potential partners or providers',
    'I want to share expertise and learn from peers',
    'I want to build relationships that could lead to future collaboration',
    'I am open to exploratory conversations'
  ];
  v_vendor_seniority_prompt TEXT := 'Which seniority levels are you hoping to meet with?';
BEGIN
  UPDATE registration_questions q
  SET is_hidden = true, updated_at = now()
  FROM registration_forms f
  WHERE q.form_id = f.id
    AND f.form_type = 'attendee'
    AND lower(btrim(q.prompt)) LIKE 'i sit in the c-suite%';

  FOR v_form IN
    SELECT id FROM registration_forms WHERE form_type = 'attendee'
  LOOP
    SELECT * INTO v_q
    FROM registration_questions
    WHERE form_id = v_form.id
      AND lower(btrim(prompt)) = lower(v_seniority_prompt)
    LIMIT 1;

    IF FOUND THEN
      UPDATE registration_questions
      SET
        help_text = NULL,
        question_type = 'single_select',
        is_required = true,
        used_in_matching = true,
        is_hidden = false,
        options = to_jsonb(v_seniority_options),
        updated_at = now()
      WHERE id = v_q.id;
      v_qid := v_q.id;
    ELSE
      SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_sort
      FROM registration_questions WHERE form_id = v_form.id;

      INSERT INTO registration_questions (
        form_id, prompt, help_text, question_type, is_required, used_in_matching,
        is_hidden, options, sort_order
      ) VALUES (
        v_form.id, v_seniority_prompt, NULL, 'single_select', true, true,
        false, to_jsonb(v_seniority_options), v_sort
      )
      RETURNING id INTO v_qid;
    END IF;

    DELETE FROM registration_question_options WHERE question_id = v_qid;
    INSERT INTO registration_question_options (question_id, label, sort_order)
    SELECT v_qid, opt, ord
    FROM unnest(v_seniority_options) WITH ORDINALITY AS t(opt, ord);
  END LOOP;

  FOR v_form IN
    SELECT id FROM registration_forms WHERE form_type IN ('attendee', 'vendor')
  LOOP
    SELECT * INTO v_q
    FROM registration_questions
    WHERE form_id = v_form.id
      AND lower(btrim(prompt)) = lower(v_meeting_goals_prompt)
    LIMIT 1;

    IF FOUND THEN
      UPDATE registration_questions
      SET
        help_text = v_meeting_goals_help,
        question_type = 'single_select',
        is_required = true,
        used_in_matching = true,
        is_hidden = false,
        options = to_jsonb(v_meeting_goals_options),
        updated_at = now()
      WHERE id = v_q.id;
      v_qid := v_q.id;
    ELSE
      SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_sort
      FROM registration_questions WHERE form_id = v_form.id;

      INSERT INTO registration_questions (
        form_id, prompt, help_text, question_type, is_required, used_in_matching,
        is_hidden, options, sort_order
      ) VALUES (
        v_form.id, v_meeting_goals_prompt, v_meeting_goals_help, 'single_select', true, true,
        false, to_jsonb(v_meeting_goals_options), v_sort
      )
      RETURNING id INTO v_qid;
    END IF;

    DELETE FROM registration_question_options WHERE question_id = v_qid;
    INSERT INTO registration_question_options (question_id, label, sort_order)
    SELECT v_qid, opt, ord
    FROM unnest(v_meeting_goals_options) WITH ORDINALITY AS t(opt, ord);
  END LOOP;

  FOR v_form IN
    SELECT id FROM registration_forms WHERE form_type = 'vendor'
  LOOP
    SELECT * INTO v_q
    FROM registration_questions
    WHERE form_id = v_form.id
      AND lower(btrim(prompt)) = lower(v_vendor_seniority_prompt)
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE registration_questions
    SET
      question_type = 'multi_select',
      is_required = true,
      used_in_matching = true,
      is_hidden = false,
      options = to_jsonb(v_seniority_options),
      updated_at = now()
    WHERE id = v_q.id;

    DELETE FROM registration_question_options WHERE question_id = v_q.id;
    INSERT INTO registration_question_options (question_id, label, sort_order)
    SELECT v_q.id, opt, ord
    FROM unnest(v_seniority_options) WITH ORDINALITY AS t(opt, ord);
  END LOOP;

  UPDATE registration_questions q
  SET used_in_matching = true, updated_at = now()
  FROM registration_forms f
  WHERE q.form_id = f.id
    AND f.form_type IN ('attendee', 'vendor')
    AND (
      lower(btrim(q.prompt)) LIKE 'which solution categor%'
      OR lower(btrim(q.prompt)) LIKE 'what solution categor%'
    );
END $$;
