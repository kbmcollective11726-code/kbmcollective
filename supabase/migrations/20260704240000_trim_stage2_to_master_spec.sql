-- Trim Stage 2 registration to Master Build Spec: hide legacy org-context + category grids.

-- Delegate: hide legacy prompts removed from spec.
UPDATE public.event_registration_questions q
SET is_hidden = true
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'attendee'
  AND q.is_base_question = true
  AND lower(trim(q.prompt)) IN (
    lower('Username (create one to login in future)'),
    lower('Please list your top 5 human resources, total rewards, and corporate wellness priorities for 2026'),
    lower('Please list your top 5 Culture, Engagement, and DE&I priorities for 2026'),
    lower('What challenges are you facing, regarding achieving these objectives?'),
    lower('Please select the time frame below that best represents the plan to achieve these objectives?'),
    lower('Total number of employees globally'),
    lower('Does your organization provide a tuition assistance benefit?'),
    lower('If yes, what amount?'),
    lower('How does formal education fit into your organization''s culture of learning?'),
    lower('Which technologies/solutions are you presently utilizing for your human resources and total rewards initiatives?'),
    lower('Which technologies or solutions are you currently utilizing for your DE&I and/or Culture & Engagement initiatives?'),
    lower('Which technologies/solutions are you presently looking to change/upgrade?'),
    lower('Are you looking to maximize your DE&I strategy with data and analytics?'),
    lower('Are you (or someone who reports to you) responsible for managing your company-wide employee survey program?'),
    lower('If Yes: When would you be willing to consider a new employee survey partner?'),
    lower('Do you or anyone in your department manage compliance requirements for labor law posters, digital postings for remote workers, mandatory employee notifications, and related requirements?'),
    lower('Are you responsible for managing your company''s rewards and benefits?'),
    lower('Are you interested in a solution that makes it easy to create short-form, TikTok-style videos to improve employee experience — from onboarding and training to recognition and employee communication?'),
    lower('Are you a minority owned organization?'),
    lower('Coaching'),
    lower('Consulting & Services'),
    lower('Culture, Engagement & Wellness'),
    lower('Technologies'),
    lower('Training'),
    lower('Workforce & Leadership Development'),
    lower('Compensation & Benefits'),
    lower('Corporate Wellness Services'),
    lower('Employee Relations'),
    lower('Executive Training & Leadership Development'),
    lower('HR Software & Technologies'),
    lower('Learning & Development Training & Programs'),
    lower('Organizational Culture'),
    lower('Talent / Human Capital Management (HCM)'),
    lower('Talent Acquisition & Management'),
    lower('Other Provider Offerings Not Listed')
  );

-- Vendor: hide legacy category grids and deprecated fields.
UPDATE public.event_registration_questions q
SET is_hidden = true
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'vendor'
  AND q.is_base_question = true
  AND lower(trim(q.prompt)) IN (
    lower('Username'),
    lower('Additional Information PDF URL'),
    lower('Are you a minority owned organization?'),
    lower('Specify your minority owned business'),
    lower('Coaching'),
    lower('Consulting & Services'),
    lower('Culture, Engagement & Wellness'),
    lower('Technologies'),
    lower('Training'),
    lower('Workforce & Leadership Development'),
    lower('Compensation & Benefits'),
    lower('Corporate Wellness Services'),
    lower('Employee Relations'),
    lower('Executive Training & Leadership Development'),
    lower('HR Software & Technologies'),
    lower('Learning & Development Training & Programs'),
    lower('Organizational Culture'),
    lower('Talent / Human Capital Management (HCM)'),
    lower('Talent Acquisition & Management'),
    lower('Other Provider Offerings Not Listed')
  );

-- Unhide spec-aligned delegate Stage 2 base questions (terms stay hidden on Stage 2 via app filter).
UPDATE public.event_registration_questions q
SET is_hidden = false
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'attendee'
  AND q.is_base_question = true
  AND lower(trim(q.prompt)) IN (
    lower('Company Name'),
    lower('First Name'),
    lower('Last Name'),
    lower('Job Title'),
    lower('E-Mail Address'),
    lower('Work Phone'),
    lower('Cell Phone'),
    lower('How did you hear about this event?'),
    lower('Dietary Restrictions'),
    lower('Preferred Pronouns'),
    lower('Address'),
    lower('City'),
    lower('State/Province'),
    lower('Zip Code/Postal Code'),
    lower('Country'),
    lower('Assistant First Name'),
    lower('Assistant Last Name'),
    lower('Assistant Email'),
    lower('Assistant Work Phone'),
    lower('Company''s Annual Revenue'),
    lower('Select your budget for external solutions for 2026'),
    lower('Scope of Responsibility'),
    lower('I sit in the C-suite or report directly to the C-suite'),
    lower('Name of person I report to'),
    lower('Solution Category of Interest'),
    lower('Meeting Goals'),
    lower('What are you hoping to get from this event?'),
    lower('Headshot/Photo')
  );

-- Unhide spec-aligned vendor Stage 2 base questions.
UPDATE public.event_registration_questions q
SET is_hidden = false
FROM public.event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience = 'vendor'
  AND q.is_base_question = true
  AND lower(trim(q.prompt)) IN (
    lower('Company Name'),
    lower('First Name'),
    lower('Last Name'),
    lower('Job Title'),
    lower('E-Mail Address'),
    lower('Work Phone'),
    lower('Cell Phone'),
    lower('Address'),
    lower('City'),
    lower('State/Province'),
    lower('Zip Code/Postal Code'),
    lower('Zip'),
    lower('Country'),
    lower('Company Description'),
    lower('Company Logo Image'),
    lower('Company Website'),
    lower('Which seniority levels are you hoping to meet with?'),
    lower('Ideal customer''s revenue range'),
    lower('Budget range you''re hoping your buyer has for 2026'),
    lower('Functions/scope you''re targeting'),
    lower('Solution/Vendor Category You Offer'),
    lower('Meeting Goals'),
    lower('What are you hoping to accomplish at this event?'),
    lower('Headshot/Photo'),
    lower('Are you sending representatives to the event onsite?'),
    lower('Will your team take meetings virtually?')
  );

-- Insert missing spec questions per form (idempotent on prompt + form_id).
DO $$
DECLARE
  r RECORD;
  v_sort INT;
BEGIN
  FOR r IN
    SELECT f.id AS form_id, f.audience
    FROM public.event_registration_forms f
    WHERE f.audience IN ('attendee', 'vendor')
  LOOP
    IF r.audience = 'attendee' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Solution Category of Interest')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'Solution Category of Interest', 'multi_select', true, 'Solution interest', true, false, v_sort);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Meeting Goals')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'Meeting Goals', 'multi_select', true, 'Meeting preferences & matching', true, false, v_sort);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('What are you hoping to get from this event?')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'What are you hoping to get from this event?', 'textarea', true, 'Meeting preferences & matching', true, false, v_sort);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Headshot/Photo')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'Headshot/Photo', 'text', true, 'Profile & event logistics', true, false, v_sort);
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Which seniority levels are you hoping to meet with?')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'Which seniority levels are you hoping to meet with?', 'multi_select', true, 'Target audience & ideal customer profile', true, false, v_sort);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Ideal customer''s revenue range')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'Ideal customer''s revenue range', 'multi_select', true, 'Target audience & ideal customer profile', true, false, v_sort);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Budget range you''re hoping your buyer has for 2026')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'Budget range you''re hoping your buyer has for 2026', 'multi_select', true, 'Target audience & ideal customer profile', true, false, v_sort);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Functions/scope you''re targeting')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'Functions/scope you''re targeting', 'multi_select', true, 'Target audience & ideal customer profile', true, false, v_sort);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Solution/Vendor Category You Offer')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'Solution/Vendor Category You Offer', 'multi_select', true, 'Solution interest (vendor)', true, false, v_sort);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Meeting Goals')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'Meeting Goals', 'multi_select', true, 'Meeting preferences & matching', true, false, v_sort);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('What are you hoping to accomplish at this event?')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'What are you hoping to accomplish at this event?', 'textarea', true, 'Meeting preferences & matching', true, false, v_sort);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.event_registration_questions q
        WHERE q.form_id = r.form_id AND lower(trim(q.prompt)) = lower('Headshot/Photo')
      ) THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM public.event_registration_questions WHERE form_id = r.form_id;
        INSERT INTO public.event_registration_questions (form_id, prompt, question_type, is_required, section_label, is_base_question, is_hidden, sort_order)
        VALUES (r.form_id, 'Headshot/Photo', 'text', true, 'Profile & event logistics', true, false, v_sort);
      END IF;
    END IF;
  END LOOP;
END $$;
