-- Move Headshot/Photo into Identity & contact for attendee + vendor forms.
UPDATE event_registration_questions q
SET
  section_label = 'Identity & contact',
  updated_at = now()
FROM event_registration_forms f
WHERE q.form_id = f.id
  AND f.audience IN ('attendee', 'vendor')
  AND lower(btrim(q.prompt)) = 'headshot/photo';

UPDATE event_registration_forms
SET section_order = COALESCE((
  SELECT jsonb_agg(to_jsonb(elem))
  FROM jsonb_array_elements_text(COALESCE(section_order, '[]'::jsonb)) AS elem
  WHERE lower(elem) NOT IN ('profile', 'profile & event logistics')
), '[]'::jsonb)
WHERE section_order IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(section_order) AS elem
    WHERE lower(elem) IN ('profile', 'profile & event logistics')
  );
