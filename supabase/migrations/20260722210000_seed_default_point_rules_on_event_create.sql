-- Always seed the core feed point rules when an event is created.
-- Clients may still insert the same defaults; ON CONFLICT keeps this idempotent.

CREATE OR REPLACE FUNCTION public.seed_default_point_rules_for_event(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.point_rules (event_id, action, points_value, max_per_day, description)
  VALUES
    (p_event_id, 'post_photo', 20, NULL, 'Post a photo'),
    (p_event_id, 'give_like', 5, NULL, 'Like someone else''s post'),
    (p_event_id, 'comment', 10, NULL, 'Comment on someone else''s post'),
    (p_event_id, 'receive_like', 5, NULL, 'Someone liked your post'),
    (p_event_id, 'receive_comment', 5, NULL, 'Someone commented on your post'),
    (p_event_id, 'give_comment_like', 5, 30, 'Like someone else''s comment'),
    (p_event_id, 'receive_comment_like', 5, 50, 'Someone liked your comment')
  ON CONFLICT (event_id, action) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_events_seed_default_point_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_point_rules_for_event(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_event_created_seed_point_rules ON public.events;
CREATE TRIGGER on_event_created_seed_point_rules
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_events_seed_default_point_rules();

REVOKE ALL ON FUNCTION public.seed_default_point_rules_for_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_default_point_rules_for_event(uuid)
  TO authenticated, service_role;

-- Backfill any event that is missing one or more defaults.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.events LOOP
    PERFORM public.seed_default_point_rules_for_event(r.id);
  END LOOP;
END;
$$;
