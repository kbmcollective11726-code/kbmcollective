-- Ensure Stage 1 Terms exists on every attendee/vendor form (public registration).
-- Stage 2 portals filter Terms out of Registration Details display.

DO $$
DECLARE
  v_form RECORD;
  v_qid UUID;
  v_sort INT;
  v_prompt TEXT := 'I have read and accept the Terms and Conditions and Code of Conduct';
BEGIN
  FOR v_form IN
    SELECT id FROM event_registration_forms WHERE audience IN ('attendee', 'vendor')
  LOOP
    IF EXISTS (
      SELECT 1 FROM event_registration_questions
      WHERE form_id = v_form.id AND lower(btrim(prompt)) = lower(v_prompt)
    ) THEN
      UPDATE event_registration_questions
      SET
        is_hidden = false,
        is_required = true,
        is_base_question = true,
        question_type = 'single_select',
        section_label = 'Stage 1 registration',
        updated_at = now()
      WHERE form_id = v_form.id AND lower(btrim(prompt)) = lower(v_prompt);
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_sort
    FROM event_registration_questions WHERE form_id = v_form.id;

    INSERT INTO event_registration_questions (
      form_id, prompt, question_type, is_required, used_in_matching,
      is_hidden, is_base_question, section_label, sort_order
    ) VALUES (
      v_form.id, v_prompt, 'single_select', true, false,
      false, true, 'Stage 1 registration', v_sort
    )
    RETURNING id INTO v_qid;

    INSERT INTO event_registration_question_options (question_id, label, value, sort_order)
    VALUES
      (v_qid, 'Yes', 'Yes', 0),
      (v_qid, 'No', 'No', 1);
  END LOOP;
END $$;
