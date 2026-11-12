-- Permanently delete all hidden registration questions (admin UI "Show" rows).
-- Cascades to options + answers via FK ON DELETE CASCADE.

DELETE FROM event_registration_questions
WHERE coalesce(is_hidden, false) = true;

UPDATE event_registration_forms f
SET section_order = COALESCE((
  SELECT jsonb_agg(to_jsonb(elem) ORDER BY ord)
  FROM jsonb_array_elements_text(COALESCE(f.section_order, '[]'::jsonb))
    WITH ORDINALITY AS t(elem, ord)
  WHERE EXISTS (
    SELECT 1
    FROM event_registration_questions q
    WHERE q.form_id = f.id
      AND lower(btrim(coalesce(q.section_label, ''))) = lower(btrim(elem))
  )
), '[]'::jsonb)
WHERE f.section_order IS NOT NULL
  AND jsonb_typeof(f.section_order) = 'array';
