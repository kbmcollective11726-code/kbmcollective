-- Award feed points in the database so posts/likes/comments earn points
-- even if the mobile client fails to call award_points_secure.

CREATE OR REPLACE FUNCTION public.try_award_points_row(
  p_user_id uuid,
  p_event_id uuid,
  p_action text,
  p_reference_id uuid,
  p_description text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points integer;
  v_max_per_day integer;
BEGIN
  IF p_user_id IS NULL OR p_event_id IS NULL OR p_action IS NULL OR p_reference_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_members
    WHERE event_id = p_event_id AND user_id = p_user_id
  ) THEN
    RETURN false;
  END IF;

  SELECT points_value, max_per_day INTO v_points, v_max_per_day
  FROM public.point_rules
  WHERE event_id = p_event_id AND action = p_action;

  IF v_points IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', p_user_id, p_event_id, p_action, p_reference_id), 0
  ));

  IF EXISTS (
    SELECT 1 FROM public.point_log
    WHERE user_id = p_user_id
      AND event_id = p_event_id
      AND action = p_action
      AND reference_id = p_reference_id
  ) THEN
    RETURN false;
  END IF;

  IF v_max_per_day IS NOT NULL AND (
    SELECT count(*) FROM public.point_log
    WHERE user_id = p_user_id
      AND event_id = p_event_id
      AND action = p_action
      AND created_at >= date_trunc('day', now())
  ) >= v_max_per_day THEN
    RETURN false;
  END IF;

  INSERT INTO public.point_log (
    user_id, event_id, action, points, reference_id, description
  ) VALUES (
    p_user_id,
    p_event_id,
    p_action,
    v_points,
    p_reference_id,
    COALESCE(NULLIF(trim(p_description), ''), replace(p_action, '_', ' '))
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_posts_award_post_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_deleted = true THEN
    RETURN NEW;
  END IF;

  -- Same duplicate-photo guard as award_points_secure
  IF NEW.image_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.posts
    WHERE event_id = NEW.event_id
      AND user_id = NEW.user_id
      AND image_hash = NEW.image_hash
      AND id <> NEW.id
      AND is_deleted = false
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.try_award_points_row(
    NEW.user_id,
    NEW.event_id,
    'post_photo',
    NEW.id,
    'Post a photo'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_likes_award_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_poster_id uuid;
BEGIN
  SELECT event_id, user_id INTO v_event_id, v_poster_id
  FROM public.posts
  WHERE id = NEW.post_id AND is_deleted = false;

  IF v_event_id IS NULL OR v_poster_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- No points for liking your own post
  IF v_poster_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.try_award_points_row(
    NEW.user_id,
    v_event_id,
    'give_like',
    NEW.post_id,
    'Like someone else''s post'
  );
  PERFORM public.try_award_points_row(
    v_poster_id,
    v_event_id,
    'receive_like',
    NEW.id,
    'Someone liked your post'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_comments_award_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_poster_id uuid;
BEGIN
  SELECT event_id, user_id INTO v_event_id, v_poster_id
  FROM public.posts
  WHERE id = NEW.post_id AND is_deleted = false;

  IF v_event_id IS NULL OR v_poster_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- No points for commenting on your own post
  IF v_poster_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.try_award_points_row(
    NEW.user_id,
    v_event_id,
    'comment',
    NEW.id,
    'Comment on someone else''s post'
  );
  PERFORM public.try_award_points_row(
    v_poster_id,
    v_event_id,
    'receive_comment',
    NEW.id,
    'Someone commented on your post'
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_comment_likes_award_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_commenter_id uuid;
BEGIN
  SELECT p.event_id, c.user_id INTO v_event_id, v_commenter_id
  FROM public.comments c
  JOIN public.posts p ON p.id = c.post_id
  WHERE c.id = NEW.comment_id AND p.is_deleted = false;

  IF v_event_id IS NULL OR v_commenter_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- No points for liking your own comment
  IF v_commenter_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.try_award_points_row(
    NEW.user_id,
    v_event_id,
    'give_comment_like',
    NEW.comment_id,
    'Like someone else''s comment'
  );
  PERFORM public.try_award_points_row(
    v_commenter_id,
    v_event_id,
    'receive_comment_like',
    NEW.id,
    'Someone liked your comment'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_post_created_award_points ON public.posts;
CREATE TRIGGER on_post_created_award_points
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_posts_award_post_photo();

DROP TRIGGER IF EXISTS on_like_created_award_points ON public.likes;
CREATE TRIGGER on_like_created_award_points
  AFTER INSERT ON public.likes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_likes_award_points();

DROP TRIGGER IF EXISTS on_comment_created_award_points ON public.comments;
CREATE TRIGGER on_comment_created_award_points
  AFTER INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_comments_award_points();

DROP TRIGGER IF EXISTS on_comment_like_created_award_points ON public.comment_likes;
CREATE TRIGGER on_comment_like_created_award_points
  AFTER INSERT ON public.comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_comment_likes_award_points();

REVOKE ALL ON FUNCTION public.try_award_points_row(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_award_points_row(uuid, uuid, text, uuid, text) TO service_role;
