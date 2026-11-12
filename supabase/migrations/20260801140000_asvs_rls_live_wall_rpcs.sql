-- ASVS hardening: scope public SELECT on users/posts/comments/event_members/schedule;
-- expose live-wall data only via SECURITY DEFINER RPCs (safe columns).
-- Mobile feed continues via authenticated membership + co-member profile SELECT.

-- ---------------------------------------------------------------------------
-- 1) Event flag FIRST (functions below reference this column)
-- ---------------------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS live_wall_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.live_wall_enabled IS
  'When true and event is active, anon may read wall-safe data via get_live_wall_* RPCs only.';

-- ---------------------------------------------------------------------------
-- 2) Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_event_member(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.is_account_active((SELECT auth.uid())), false)
    AND EXISTS (
      SELECT 1
      FROM public.event_members em
      WHERE em.event_id = p_event_id
        AND em.user_id = (SELECT auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION public.is_event_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_event_member(uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.is_live_wall_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND e.is_active = true
      AND COALESCE(e.live_wall_enabled, true) = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_live_wall_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_live_wall_event(uuid) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3) Live-wall RPCs (safe columns only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_live_wall_events()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object('id', e.id, 'name', e.name)
        ORDER BY e.start_date DESC NULLS LAST
      )
      FROM public.events e
      WHERE e.is_active = true
        AND e.live_wall_enabled = true
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_live_wall_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF p_event_id IS NULL OR NOT public.is_live_wall_event(p_event_id) THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'name', e.name,
    'start_date', e.start_date,
    'end_date', e.end_date,
    'reminder_timezone', e.reminder_timezone
  )
  INTO v_row
  FROM public.events e
  WHERE e.id = p_event_id;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_live_wall_posts(
  p_event_id uuid,
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 200), 200));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
BEGIN
  IF p_event_id IS NULL OR NOT public.is_live_wall_event(p_event_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY ord)
      FROM (
        SELECT
          jsonb_build_object(
            'id', p.id,
            'image_url', p.image_url,
            'caption', p.caption,
            'likes_count', p.likes_count,
            'comments_count', p.comments_count,
            'created_at', p.created_at,
            'is_pinned', p.is_pinned,
            'user', jsonb_build_object('full_name', u.full_name)
          ) AS row_data,
          ROW_NUMBER() OVER (
            ORDER BY p.is_pinned DESC NULLS LAST, p.created_at DESC NULLS LAST
          ) AS ord
        FROM public.posts p
        LEFT JOIN public.users u ON u.id = p.user_id
        WHERE p.event_id = p_event_id
          AND p.is_deleted = false
          AND p.is_approved = true
        ORDER BY p.is_pinned DESC NULLS LAST, p.created_at DESC NULLS LAST
        LIMIT v_limit
        OFFSET v_offset
      ) q
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_live_wall_comments(
  p_event_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 100));
BEGIN
  IF p_event_id IS NULL OR NOT public.is_live_wall_event(p_event_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY ord)
      FROM (
        SELECT
          jsonb_build_object(
            'id', c.id,
            'content', c.content,
            'created_at', c.created_at,
            'post_id', c.post_id,
            'user', jsonb_build_object('full_name', u.full_name)
          ) AS row_data,
          ROW_NUMBER() OVER (ORDER BY c.created_at DESC NULLS LAST) AS ord
        FROM public.comments c
        INNER JOIN public.posts p ON p.id = c.post_id
        LEFT JOIN public.users u ON u.id = c.user_id
        WHERE p.event_id = p_event_id
          AND p.is_deleted = false
          AND p.is_approved = true
        ORDER BY c.created_at DESC NULLS LAST
        LIMIT v_limit
      ) q
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_live_wall_comments_for_post(
  p_post_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_event_id uuid;
BEGIN
  SELECT p.event_id INTO v_event_id
  FROM public.posts p
  WHERE p.id = p_post_id
    AND p.is_deleted = false
    AND p.is_approved = true;
  IF v_event_id IS NULL OR NOT public.is_live_wall_event(v_event_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY ord)
      FROM (
        SELECT
          jsonb_build_object(
            'id', c.id,
            'content', c.content,
            'created_at', c.created_at,
            'user', jsonb_build_object('full_name', u.full_name)
          ) AS row_data,
          ROW_NUMBER() OVER (ORDER BY c.created_at DESC NULLS LAST) AS ord
        FROM public.comments c
        LEFT JOIN public.users u ON u.id = c.user_id
        WHERE c.post_id = p_post_id
        ORDER BY c.created_at DESC NULLS LAST
        LIMIT v_limit
      ) q
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_live_wall_leaderboard(
  p_event_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 25));
BEGIN
  IF p_event_id IS NULL OR NOT public.is_live_wall_event(p_event_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY ord)
      FROM (
        SELECT
          jsonb_build_object(
            'user_id', em.user_id,
            'points', em.points,
            'users', jsonb_build_object(
              'full_name', u.full_name,
              'avatar_url', u.avatar_url,
              'title', u.title
            )
          ) AS row_data,
          ROW_NUMBER() OVER (ORDER BY em.points DESC NULLS LAST) AS ord
        FROM public.event_members em
        INNER JOIN public.users u ON u.id = em.user_id
        WHERE em.event_id = p_event_id
        ORDER BY em.points DESC NULLS LAST
        LIMIT v_limit
      ) q
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_live_wall_member_count(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_id IS NULL OR NOT public.is_live_wall_event(p_event_id) THEN
    RETURN 0;
  END IF;
  RETURN (
    SELECT COUNT(*)::integer
    FROM public.event_members em
    WHERE em.event_id = p_event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_live_wall_sessions(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_id IS NULL OR NOT public.is_live_wall_event(p_event_id) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE(
    (
      SELECT jsonb_agg(row_data ORDER BY ord)
      FROM (
        SELECT
          jsonb_build_object(
            'id', s.id,
            'title', s.title,
            'start_time', s.start_time,
            'end_time', s.end_time,
            'day_number', s.day_number,
            'location', s.location,
            'description', s.description,
            'is_active', s.is_active
          ) AS row_data,
          ROW_NUMBER() OVER (
            ORDER BY s.day_number ASC NULLS LAST, s.start_time ASC NULLS LAST
          ) AS ord
        FROM public.schedule_sessions s
        WHERE s.event_id = p_event_id
          AND s.is_active = true
        ORDER BY s.day_number ASC NULLS LAST, s.start_time ASC NULLS LAST
      ) q
    ),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_live_wall_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_live_wall_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_live_wall_posts(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_live_wall_comments(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_live_wall_comments_for_post(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_live_wall_leaderboard(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_live_wall_member_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_live_wall_sessions(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_live_wall_events() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_wall_event(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_wall_posts(uuid, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_wall_comments(uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_wall_comments_for_post(uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_wall_leaderboard(uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_wall_member_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_wall_sessions(uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Tighten table RLS
-- ---------------------------------------------------------------------------

-- users: drop public SELECT; authenticated self / co-member / platform admin
DROP POLICY IF EXISTS "Users are viewable by everyone" ON public.users;
DROP POLICY IF EXISTS "users_select_perm" ON public.users;
DROP POLICY IF EXISTS "users_select_scoped" ON public.users;
CREATE POLICY "users_select_scoped" ON public.users
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR public.is_platform_admin((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.event_members me
      JOIN public.event_members them ON them.event_id = me.event_id
      WHERE me.user_id = (SELECT auth.uid())
        AND them.user_id = users.id
    )
  );

-- posts: members see non-deleted in their events; admins/platform always for their scope
DROP POLICY IF EXISTS "posts_select_perm" ON public.posts;
DROP POLICY IF EXISTS "Posts are viewable by everyone" ON public.posts;
CREATE POLICY "posts_select_perm" ON public.posts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_platform_admin((SELECT auth.uid()))
    OR public.is_event_admin(event_id)
    OR (
      public.is_event_member(event_id)
      AND is_deleted = false
    )
  );

DROP POLICY IF EXISTS "posts_insert_perm" ON public.posts;
CREATE POLICY "posts_insert_perm" ON public.posts
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      public.is_platform_admin((SELECT auth.uid()))
      OR public.is_event_admin(event_id)
      OR public.is_event_member(event_id)
    )
  );

-- comments: via post's event membership
DROP POLICY IF EXISTS "Comments are viewable" ON public.comments;
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.comments;
DROP POLICY IF EXISTS "comments_select_perm" ON public.comments;
CREATE POLICY "comments_select_perm" ON public.comments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_platform_admin((SELECT auth.uid()))
    OR EXISTS (
      SELECT 1
      FROM public.posts p
      WHERE p.id = comments.post_id
        AND (
          public.is_event_admin(p.event_id)
          OR (public.is_event_member(p.event_id) AND p.is_deleted = false)
        )
    )
  );

-- event_members: remove OR true
DROP POLICY IF EXISTS "event_members_select_perm" ON public.event_members;
CREATE POLICY "event_members_select_perm" ON public.event_members
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_platform_admin((SELECT auth.uid()))
    OR public.is_event_admin(event_id)
    OR public.is_event_member(event_id)
  );

-- schedule_sessions: remove OR true
DROP POLICY IF EXISTS "schedule_sessions_select_perm" ON public.schedule_sessions;
CREATE POLICY "schedule_sessions_select_perm" ON public.schedule_sessions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_platform_admin((SELECT auth.uid()))
    OR public.is_event_admin(event_id)
    OR public.is_event_member(event_id)
  );

-- Defense in depth: anon should not need table SELECT on these (RPC only)
REVOKE ALL ON TABLE public.users FROM anon;
REVOKE ALL ON TABLE public.posts FROM anon;
REVOKE ALL ON TABLE public.comments FROM anon;
REVOKE ALL ON TABLE public.event_members FROM anon;
REVOKE ALL ON TABLE public.schedule_sessions FROM anon;

GRANT SELECT ON TABLE public.users TO authenticated;
GRANT SELECT ON TABLE public.posts TO authenticated;
GRANT SELECT ON TABLE public.comments TO authenticated;
GRANT SELECT ON TABLE public.event_members TO authenticated;
GRANT SELECT ON TABLE public.schedule_sessions TO authenticated;
