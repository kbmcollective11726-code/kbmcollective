-- Comment likes: one like per user per comment, counts, points, and unlike cleanup.

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comment_likes_unique_user_comment UNIQUE (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON public.comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_user ON public.comment_likes(user_id);

COMMENT ON TABLE public.comment_likes IS 'One row per user per comment like; drives comments.likes_count.';

-- Keep comments.likes_count in sync
CREATE OR REPLACE FUNCTION public.update_comment_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.comments SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_comment_like_change ON public.comment_likes;
CREATE TRIGGER on_comment_like_change
  AFTER INSERT OR DELETE ON public.comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_comment_likes_count();

-- Remove points when a comment like is removed (mirrors post likes)
CREATE OR REPLACE FUNCTION public.remove_points_on_comment_unlike()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_comment_author_id UUID;
BEGIN
  SELECT p.event_id, c.user_id
  INTO v_event_id, v_comment_author_id
  FROM public.comments c
  JOIN public.posts p ON p.id = c.post_id
  WHERE c.id = OLD.comment_id;

  IF v_event_id IS NULL OR v_comment_author_id IS NULL THEN
    RETURN OLD;
  END IF;

  DELETE FROM public.point_log
  WHERE user_id = OLD.user_id
    AND event_id = v_event_id
    AND action = 'give_comment_like'
    AND reference_id = OLD.comment_id;

  DELETE FROM public.point_log
  WHERE user_id = v_comment_author_id
    AND event_id = v_event_id
    AND action = 'receive_comment_like'
    AND reference_id = OLD.id;

  UPDATE public.event_members em
  SET points = (
    SELECT COALESCE(SUM(pl.points), 0)::integer
    FROM public.point_log pl
    WHERE pl.user_id = em.user_id AND pl.event_id = em.event_id
  )
  WHERE em.event_id = v_event_id
    AND em.user_id IN (OLD.user_id, v_comment_author_id);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_comment_like_deleted_remove_points ON public.comment_likes;
CREATE TRIGGER on_comment_like_deleted_remove_points
  AFTER DELETE ON public.comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.remove_points_on_comment_unlike();

ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comment likes are viewable" ON public.comment_likes;
CREATE POLICY "Comment likes are viewable" ON public.comment_likes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can like comments" ON public.comment_likes;
CREATE POLICY "Users can like comments" ON public.comment_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can unlike comments" ON public.comment_likes;
CREATE POLICY "Users can unlike comments" ON public.comment_likes
  FOR DELETE USING (auth.uid() = user_id);

-- Point rule actions
ALTER TABLE public.point_rules DROP CONSTRAINT IF EXISTS point_rules_action_check;

ALTER TABLE public.point_rules ADD CONSTRAINT point_rules_action_check CHECK (
  action IN (
    'post_photo',
    'receive_like',
    'give_like',
    'comment',
    'receive_comment',
    'give_comment_like',
    'receive_comment_like',
    'connect',
    'attend_session',
    'complete_profile',
    'daily_streak',
    'vendor_meeting',
    'checkin',
    'share_linkedin',
    'session_feedback',
    'b2b_feedback'
  )
);

-- Seed default comment-like rules for existing events (same values as post likes)
INSERT INTO public.point_rules (event_id, action, points_value, max_per_day, description)
SELECT e.id, v.action, v.points_value, v.max_per_day, v.description
FROM public.events e
CROSS JOIN (
  VALUES
    ('give_comment_like'::text, 5, 30, 'Like someone else''s comment'),
    ('receive_comment_like'::text, 5, 50, 'Someone liked your comment')
) AS v(action, points_value, max_per_day, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.point_rules pr
  WHERE pr.event_id = e.id AND pr.action = v.action
);
