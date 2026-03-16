-- =============================================================================
-- APPLY ALL MIGRATIONS IN ONE GO
-- =============================================================================
-- 1. Copy this ENTIRE file.
-- 2. Supabase Dashboard → SQL Editor → New query → Paste → Run.
-- 3. If you get errors about missing tables (e.g. users, events), run your
--    main schema first (e.g. supabase-schema.sql or Supabase project init).
-- 4. After this runs, vendor booth Save and Assign meeting will work.
-- =============================================================================

-- ========== PART A: ENSURE-ALL-TABLES (columns, chat groups, helpers, RLS) ==========

-- 1) Users: platform admin column
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- 2) Event members: roles array
ALTER TABLE public.event_members
  ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT NULL;

-- 3) Notifications: allow type 'connection_request'
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%type%';
  IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', cname); END IF;
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like', 'comment', 'message', 'announcement', 'points', 'badge', 'meeting', 'schedule_change', 'connection_request', 'system'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 4) Messages: attachment
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_url TEXT, ADD COLUMN IF NOT EXISTS attachment_type TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE table_schema = 'public' AND table_name = 'messages' AND constraint_name LIKE '%attachment_type%') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_attachment_type_check CHECK (attachment_type IS NULL OR attachment_type = 'image');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 5) Announcements: targeting and scheduling
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS target_audience TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_user_ids UUID[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ DEFAULT NULL;

-- 6) Chat groups
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

-- 7) Blocked users & user reports
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

-- 8) Session reminder sent
CREATE TABLE IF NOT EXISTS public.session_reminder_sent (
  session_id UUID NOT NULL REFERENCES public.schedule_sessions(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id)
);
ALTER TABLE public.session_reminder_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role can manage session_reminder_sent" ON public.session_reminder_sent;
CREATE POLICY "Service role can manage session_reminder_sent" ON public.session_reminder_sent FOR ALL USING (true) WITH CHECK (true);

-- 9) Admin helpers (required for RLS below)
CREATE OR REPLACE FUNCTION public.is_event_admin(p_event_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = p_event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin'));
$$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE((SELECT u.is_platform_admin FROM public.users u WHERE u.id = p_user_id), false);
$$;
CREATE OR REPLACE FUNCTION public.can_manage_chat_group_members(p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT (public.is_event_admin(cg.event_id) OR public.is_platform_admin(auth.uid())) FROM public.chat_groups cg WHERE cg.id = p_group_id LIMIT 1;
$$;

-- 10) Chat groups RLS
DROP POLICY IF EXISTS "View chat groups: member or event admin" ON public.chat_groups;
CREATE POLICY "View chat groups: member or event admin" ON public.chat_groups FOR SELECT USING (
  CASE WHEN public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()) THEN true
  ELSE EXISTS (SELECT 1 FROM public.chat_group_members cgm WHERE cgm.group_id = chat_groups.id AND cgm.user_id = auth.uid()) END
);
DROP POLICY IF EXISTS "Admins can create chat groups" ON public.chat_groups;
CREATE POLICY "Admins can create chat groups" ON public.chat_groups FOR INSERT WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can update chat groups" ON public.chat_groups;
CREATE POLICY "Admins can update chat groups" ON public.chat_groups FOR UPDATE USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid())) WITH CHECK (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can delete chat groups" ON public.chat_groups;
CREATE POLICY "Admins can delete chat groups" ON public.chat_groups FOR DELETE USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can manage chat group members" ON public.chat_group_members;
CREATE POLICY "Admins can manage chat group members" ON public.chat_group_members FOR ALL USING (public.can_manage_chat_group_members(group_id)) WITH CHECK (public.can_manage_chat_group_members(group_id));
DROP POLICY IF EXISTS "Members can view chat group members" ON public.chat_group_members;
CREATE POLICY "Members can view chat group members" ON public.chat_group_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.chat_group_members cgm2 WHERE cgm2.group_id = chat_group_members.group_id AND cgm2.user_id = auth.uid())
);
DROP POLICY IF EXISTS "Group members can view messages" ON public.group_messages;
CREATE POLICY "Group members can view messages" ON public.group_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.chat_group_members cgm WHERE cgm.group_id = group_messages.group_id AND cgm.user_id = auth.uid())
);
DROP POLICY IF EXISTS "Group members can send messages" ON public.group_messages;
CREATE POLICY "Group members can send messages" ON public.group_messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id AND EXISTS (SELECT 1 FROM public.chat_group_members cgm WHERE cgm.group_id = group_messages.group_id AND cgm.user_id = auth.uid())
);

-- ========== PART B: RUN-THESE-MIGRATIONS (B2B, session ratings, meeting policies) ==========

-- B2B tables
CREATE TABLE IF NOT EXISTS public.vendor_booths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  booth_location TEXT,
  contact_user_id UUID REFERENCES public.users(id),
  website TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.meeting_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booth_id UUID NOT NULL REFERENCES public.vendor_booths(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.meeting_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES public.meeting_slots(id) ON DELETE CASCADE,
  attendee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'declined', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(slot_id, attendee_id)
);
ALTER TABLE public.vendor_booths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_booths ADD COLUMN IF NOT EXISTS banner_url TEXT;

DROP POLICY IF EXISTS "Vendor booths viewable" ON public.vendor_booths;
CREATE POLICY "Vendor booths viewable" ON public.vendor_booths FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage booths" ON public.vendor_booths;
CREATE POLICY "Admins manage booths" ON public.vendor_booths FOR ALL USING (
  EXISTS (SELECT 1 FROM public.event_members WHERE user_id = auth.uid() AND event_id = vendor_booths.event_id AND role IN ('admin', 'super_admin'))
);
DROP POLICY IF EXISTS "Slots viewable" ON public.meeting_slots;
CREATE POLICY "Slots viewable" ON public.meeting_slots FOR SELECT USING (true);
DROP POLICY IF EXISTS "Vendors manage slots" ON public.meeting_slots;
CREATE POLICY "Vendors manage slots" ON public.meeting_slots FOR ALL USING (
  EXISTS (SELECT 1 FROM public.vendor_booths vb JOIN public.event_members em ON em.event_id = vb.event_id WHERE vb.id = meeting_slots.booth_id AND em.user_id = auth.uid() AND em.role IN ('vendor', 'admin', 'super_admin'))
);
DROP POLICY IF EXISTS "Users see own bookings" ON public.meeting_bookings;
CREATE POLICY "Users see own bookings" ON public.meeting_bookings FOR SELECT USING (auth.uid() = attendee_id);
DROP POLICY IF EXISTS "Users can book" ON public.meeting_bookings;
CREATE POLICY "Users can book" ON public.meeting_bookings FOR INSERT WITH CHECK (auth.uid() = attendee_id);
DROP POLICY IF EXISTS "Users can cancel own bookings" ON public.meeting_bookings;
CREATE POLICY "Users can cancel own bookings" ON public.meeting_bookings FOR UPDATE USING (auth.uid() = attendee_id);

-- Session ratings
CREATE TABLE IF NOT EXISTS public.session_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.schedule_sessions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_session_ratings_session ON public.session_ratings(session_id);
CREATE INDEX IF NOT EXISTS idx_session_ratings_user ON public.session_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_session_ratings_event ON public.session_ratings(event_id);
ALTER TABLE public.session_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own session ratings" ON public.session_ratings FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Event admins can view all session ratings in event" ON public.session_ratings FOR SELECT USING (public.is_event_admin(event_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "Event members can insert own session rating" ON public.session_ratings FOR INSERT WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = session_ratings.event_id AND em.user_id = auth.uid()));
CREATE POLICY "Users can update own session rating" ON public.session_ratings FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_session_rating_stats(p_session_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE v_event_id UUID; v_can_see BOOLEAN := false; v_avg NUMERIC; v_count BIGINT;
BEGIN
  SELECT event_id INTO v_event_id FROM public.schedule_sessions WHERE id = p_session_id LIMIT 1;
  IF v_event_id IS NULL THEN RETURN jsonb_build_object('avg_rating', null, 'count', 0); END IF;
  v_can_see := public.is_event_admin(v_event_id) OR public.is_platform_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = v_event_id AND em.user_id = auth.uid());
  IF NOT v_can_see THEN RETURN jsonb_build_object('avg_rating', null, 'count', 0); END IF;
  SELECT AVG(rating)::NUMERIC(3,2), count(*) INTO v_avg, v_count FROM public.session_ratings WHERE session_id = p_session_id;
  RETURN jsonb_build_object('avg_rating', v_avg, 'count', COALESCE(v_count, 0)::int);
END; $$;

-- Meeting bookings: admin assign + vendors view/update
CREATE POLICY "Admins can assign meeting bookings" ON public.meeting_bookings FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.meeting_slots ms JOIN public.vendor_booths vb ON vb.id = ms.booth_id JOIN public.event_members em ON em.event_id = vb.event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin') WHERE ms.id = meeting_bookings.slot_id)
);
CREATE POLICY "Vendors and admins can view event booth bookings" ON public.meeting_bookings FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.meeting_slots ms JOIN public.vendor_booths vb ON vb.id = ms.booth_id JOIN public.event_members em ON em.event_id = vb.event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin', 'vendor') WHERE ms.id = meeting_bookings.slot_id)
);
CREATE POLICY "Vendors and admins can update event booth bookings" ON public.meeting_bookings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.meeting_slots ms JOIN public.vendor_booths vb ON vb.id = ms.booth_id JOIN public.event_members em ON em.event_id = vb.event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin', 'vendor') WHERE ms.id = meeting_bookings.slot_id)
);

-- ========== VERIFICATION: run this query after the script to confirm tables ==========
-- (Uncomment the next 3 lines and run again to see table status, or run in a separate query.)
/*
SELECT table_name AS "Table", 'OK' AS "Status"
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN (
  'users','events','event_members','posts','likes','comments','messages','notifications','announcements',
  'schedule_sessions','user_schedule','point_rules','point_log','connections','connection_requests',
  'blocked_users','user_reports','chat_groups','chat_group_members','group_messages',
  'session_reminder_sent','vendor_booths','meeting_slots','meeting_bookings','session_ratings'
)
ORDER BY table_name;
*/
