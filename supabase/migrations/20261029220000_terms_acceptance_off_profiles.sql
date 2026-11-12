-- Terms acceptance is a form formality, not profile content.

CREATE OR REPLACE FUNCTION public.registration_prompt_private_by_default(p_prompt TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.registration_prompt_is_contact(p_prompt)
    OR lower(trim(coalesce(p_prompt, ''))) IN (
      'dietary restrictions',
      'how did you hear about this event?',
      'username (create one to login in future)',
      'username'
    )
    OR lower(trim(coalesce(p_prompt, ''))) LIKE 'i have read and accept%';
$$;

UPDATE public.event_registration_questions
SET show_on_profile = false
WHERE lower(trim(prompt)) LIKE 'i have read and accept%'
  AND show_on_profile = true;
