-- ============================================================
-- ENSURE ALL TABLES AND COLUMNS EXIST (idempotent)
-- Run this in Supabase Dashboard → SQL Editor.
-- Use after supabase-schema.sql + RESTORE steps, or to fix missing pieces.
-- ============================================================

-- ---------- 1) Users: platform admin column ----------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- ---------- 2) Event members: roles array (multi-role per event) ----------
ALTER TABLE public.event_members
  ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT NULL;
COMMENT ON COLUMN public.event_members.roles IS 'All roles for this user in this event (e.g. speaker, vendor). role is primary/display.';

-- ---------- 3) Notifications: allow type 'connection_request' ----------
DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('like', 'comment', 'message', 'announcement', 'points', 'badge', 'meeting', 'schedule_change', 'connection_request', 'system'));
EXCEPTION WHEN OTHERS THEN
  NULL; -- e.g. constraint already allows connection_request
END $$;

-- ---------- 4) Messages: optional attachment (DMs) ----------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public' AND table_name = 'messages'
    AND constraint_name LIKE '%attachment_type%'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_attachment_type_check
      CHECK (attachment_type IS NULL OR attachment_type = 'image');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ---------- 5) Announcements: targeting and scheduling ----------
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS target_audience TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_user_ids UUID[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NULL;

-- ---------- 6) Chat groups (group chat) ----------
CREATE TABLE IF NOT EXISTS public.chat_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_groups_event ON public.chat_groups(event_id);

CREATE TABLE IF NOT EXISTS public.chat_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_group ON public.chat_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_user ON public.chat_group_members(user_id);

CREATE TABLE IF NOT EXISTS public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  attachment_url TEXT,
  attachment_type TEXT DEFAULT 'image',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON public.group_messages(group_id, created_at);

ALTER TABLE public.chat_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

-- ---------- 7) Blocked users & user reports ----------
CREATE TABLE IF NOT EXISTS public.blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(blocker_id, blocked_user_id)
);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON public.blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON public.blocked_users(blocked_user_id);
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'inappropriate', 'other')),
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_reports_reporter ON public.user_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON public.user_reports(reported_user_id);
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

-- Policies for blocked_users and user_reports
DROP POLICY IF EXISTS "Users can view own blocks" ON public.blocked_users;
DROP POLICY IF EXISTS "Users can insert own blocks" ON public.blocked_users;
DROP POLICY IF EXISTS "Users can delete own blocks" ON public.blocked_users;
CREATE POLICY "Users can view own blocks" ON public.blocked_users FOR SELECT USING (auth.uid() = blocker_id);
CREATE POLICY "Users can insert own blocks" ON public.blocked_users FOR INSERT WITH CHECK (auth.uid() = blocker_id);
CREATE POLICY "Users can delete own blocks" ON public.blocked_users FOR DELETE USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users can insert own reports" ON public.user_reports;
DROP POLICY IF EXISTS "Users can view own reports" ON public.user_reports;
CREATE POLICY "Users can insert own reports" ON public.user_reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Users can view own reports" ON public.user_reports FOR SELECT USING (auth.uid() = reporter_id);

-- ---------- 8) Session reminder sent (for notify-event-starting-soon cron) ----------
CREATE TABLE IF NOT EXISTS public.session_reminder_sent (
  session_id UUID NOT NULL REFERENCES public.schedule_sessions(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id)
);
ALTER TABLE public.session_reminder_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role can manage session_reminder_sent" ON public.session_reminder_sent;
CREATE POLICY "Service role can manage session_reminder_sent" ON public.session_reminder_sent FOR ALL USING (true) WITH CHECK (true);

-- ---------- 8b) B2B meeting reminder sent (notify-b2b-meeting-soon) ----------
-- Requires public.meeting_bookings (B2B schema). If missing, run APPLY-ALL-MIGRATIONS or your base schema first.
CREATE TABLE IF NOT EXISTS public.b2b_meeting_reminder_sent (
  booking_id UUID PRIMARY KEY REFERENCES public.meeting_bookings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.b2b_meeting_reminder_sent IS 'One row per booking when we sent the "meeting in 5 min" push. Used by notify-b2b-meeting-soon.';
ALTER TABLE public.b2b_meeting_reminder_sent ENABLE ROW LEVEL SECURITY;

-- ---------- 9) Admin helpers (for RLS) ----------
CREATE OR REPLACE FUNCTION public.is_event_admin(p_event_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = p_event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(
    (SELECT u.is_platform_admin FROM public.users u WHERE u.id = p_user_id),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_chat_group_members(p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT (public.is_event_admin(cg.event_id) OR public.is_platform_admin(auth.uid()))
  FROM public.chat_groups cg WHERE cg.id = p_group_id LIMIT 1;
$$;

-- ---------- 10) Chat groups RLS (avoids recursion) ----------
DROP POLICY IF EXISTS "Members can view chat groups they are in" ON public.chat_groups;
DROP POLICY IF EXISTS "Admins can view chat groups in their event" ON public.chat_groups;
DROP POLICY IF EXISTS "View chat groups: member or event admin" ON public.chat_groups;
CREATE POLICY "View chat groups: member or event admin" ON public.chat_groups
  FOR SELECT USING (
    CASE
      WHEN public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()) THEN true
      ELSE EXISTS (
        SELECT 1 FROM public.chat_group_members cgm
        WHERE cgm.group_id = chat_groups.id AND cgm.user_id = auth.uid()
      )
    END
  );

DROP POLICY IF EXISTS "Admins can create chat groups" ON public.chat_groups;
CREATE POLICY "Admins can create chat groups" ON public.chat_groups
  FOR INSERT WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update chat groups" ON public.chat_groups;
CREATE POLICY "Admins can update chat groups" ON public.chat_groups
  FOR UPDATE USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete chat groups" ON public.chat_groups;
CREATE POLICY "Admins can delete chat groups" ON public.chat_groups
  FOR DELETE USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));

-- Chat group members: use SECURITY DEFINER function to avoid RLS recursion
DROP POLICY IF EXISTS "Admins can manage chat group members" ON public.chat_group_members;
CREATE POLICY "Admins can manage chat group members" ON public.chat_group_members
  FOR ALL
  USING (public.can_manage_chat_group_members(group_id))
  WITH CHECK (public.can_manage_chat_group_members(group_id));

DROP POLICY IF EXISTS "Members can view chat group members" ON public.chat_group_members;
CREATE POLICY "Members can view chat group members" ON public.chat_group_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_group_members cgm2
      WHERE cgm2.group_id = chat_group_members.group_id AND cgm2.user_id = auth.uid()
    )
  );

-- Group messages
DROP POLICY IF EXISTS "Group members can view messages" ON public.group_messages;
CREATE POLICY "Group members can view messages" ON public.group_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.chat_group_members cgm WHERE cgm.group_id = group_messages.group_id AND cgm.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Group members can send messages" ON public.group_messages;
CREATE POLICY "Group members can send messages" ON public.group_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (SELECT 1 FROM public.chat_group_members cgm WHERE cgm.group_id = group_messages.group_id AND cgm.user_id = auth.uid())
  );

-- Realtime for group_messages
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'group_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Done. Run CHECK-TABLES-AND-COLUMNS.sql to verify.
