-- ============================================
-- COLLECTIVELIVE — Complete Database Schema
-- Run this ENTIRE file in Supabase SQL Editor
-- ============================================

-- ==================
-- USERS
-- ==================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    title TEXT,
    company TEXT,
    linkedin_url TEXT,
    bio TEXT,
    phone TEXT,
    push_token TEXT,
    is_active BOOLEAN DEFAULT true,
    is_platform_admin BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================
-- EVENTS
-- ==================
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    location TEXT,
    venue TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    banner_url TEXT,
    logo_url TEXT,
    theme_color TEXT DEFAULT '#2563eb',
    welcome_message TEXT,
    wifi_info TEXT,
    map_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    -- Event code for join-by-code (unique, generated on create)
    event_code TEXT UNIQUE,
    -- Info page (admin-editable, summit-style)
    welcome_title TEXT,
    welcome_subtitle TEXT,
    hero_stat_1 TEXT,
    hero_stat_2 TEXT,
    hero_stat_3 TEXT,
    arrival_day_text TEXT,
    summit_days_text TEXT,
    theme_text TEXT,
    what_to_expect JSONB DEFAULT '[]'::jsonb,
    points_section_intro TEXT
);

-- ==================
-- EVENT MEMBERS (links users to events with roles)
-- ==================
CREATE TABLE IF NOT EXISTS public.event_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'attendee' CHECK (role IN ('attendee', 'speaker', 'vendor', 'admin', 'super_admin')),
    points INTEGER DEFAULT 0,
    joined_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, user_id)
);

-- ==================
-- POSTS (photo feed)
-- ==================
CREATE TABLE IF NOT EXISTS public.posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    caption TEXT,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    is_pinned BOOLEAN DEFAULT false,
    is_approved BOOLEAN DEFAULT true,
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_event ON public.posts(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user ON public.posts(user_id);

-- ==================
-- LIKES
-- ==================
CREATE TABLE IF NOT EXISTS public.likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(post_id, user_id)
);

-- ==================
-- COMMENTS
-- ==================
CREATE TABLE IF NOT EXISTS public.comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON public.comments(post_id, created_at);

-- ==================
-- SCHEDULE SESSIONS
-- ==================
CREATE TABLE IF NOT EXISTS public.schedule_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    speaker_name TEXT,
    speaker_title TEXT,
    speaker_photo TEXT,
    location TEXT,
    room TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    day_number INTEGER NOT NULL DEFAULT 1,
    track TEXT,
    session_type TEXT DEFAULT 'breakout' CHECK (session_type IN ('keynote', 'breakout', 'workshop', 'social', 'meal', 'networking', 'vendor')),
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_event ON public.schedule_sessions(event_id, day_number, start_time);

-- ==================
-- USER SCHEDULE (bookmarked sessions)
-- ==================
CREATE TABLE IF NOT EXISTS public.user_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.schedule_sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, session_id)
);

-- ==================
-- MESSAGES (Direct Messages)
-- ==================
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(sender_id, receiver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON public.messages(receiver_id, is_read);

-- ==================
-- ANNOUNCEMENTS (Admin broadcasts)
-- ==================
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    send_push BOOLEAN DEFAULT false,
    sent_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================
-- NOTIFICATIONS
-- ==================
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'message', 'announcement', 'points', 'badge', 'meeting', 'schedule_change', 'system')),
    title TEXT NOT NULL,
    body TEXT,
    data JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read, created_at DESC);

-- ==================
-- POINT RULES (configurable per event)
-- ==================
CREATE TABLE IF NOT EXISTS public.point_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('post_photo', 'receive_like', 'give_like', 'comment', 'receive_comment', 'connect', 'attend_session', 'complete_profile', 'daily_streak', 'vendor_meeting', 'checkin', 'share_linkedin')),
    points_value INTEGER NOT NULL DEFAULT 10,
    max_per_day INTEGER,
    description TEXT,
    UNIQUE(event_id, action)
);

-- ==================
-- POINT LOG (audit trail)
-- ==================
CREATE TABLE IF NOT EXISTS public.point_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    points INTEGER NOT NULL,
    reference_id UUID,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_point_log_user_event ON public.point_log(user_id, event_id, created_at DESC);

-- ==================
-- VENDOR BOOTHS
-- ==================
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

-- ==================
-- MEETING SLOTS
-- ==================
CREATE TABLE IF NOT EXISTS public.meeting_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booth_id UUID NOT NULL REFERENCES public.vendor_booths(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================
-- MEETING BOOKINGS
-- ==================
CREATE TABLE IF NOT EXISTS public.meeting_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID NOT NULL REFERENCES public.meeting_slots(id) ON DELETE CASCADE,
    attendee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'declined', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(slot_id, attendee_id)
);

-- ==================
-- CONNECTIONS (networking)
-- ==================
CREATE TABLE IF NOT EXISTS public.connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    connected_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, user_id, connected_user_id)
);

-- Connection requests: user must accept before connection is created
CREATE TABLE IF NOT EXISTS public.connection_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    requester_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    requested_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, requester_id, requested_user_id)
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_booths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;

-- Drop existing policies so CREATE POLICY is safe to re-run (idempotent)
DROP POLICY IF EXISTS "Users are viewable by everyone" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Events are viewable by everyone" ON public.events;
DROP POLICY IF EXISTS "Authenticated users can create events" ON public.events;
DROP POLICY IF EXISTS "Admins can update events" ON public.events;
DROP POLICY IF EXISTS "Admins can delete events" ON public.events;
DROP POLICY IF EXISTS "Members can view event members" ON public.event_members;
DROP POLICY IF EXISTS "Users can join events" ON public.event_members;
DROP POLICY IF EXISTS "Admins can manage members" ON public.event_members;
DROP POLICY IF EXISTS "Users can update own role" ON public.event_members;
DROP POLICY IF EXISTS "Posts are viewable by everyone" ON public.posts;
DROP POLICY IF EXISTS "Users can create posts" ON public.posts;
DROP POLICY IF EXISTS "Users can update own posts" ON public.posts;
DROP POLICY IF EXISTS "Admins can manage posts" ON public.posts;
DROP POLICY IF EXISTS "Likes are viewable" ON public.likes;
DROP POLICY IF EXISTS "Users can like" ON public.likes;
DROP POLICY IF EXISTS "Users can unlike" ON public.likes;
DROP POLICY IF EXISTS "Comments are viewable" ON public.comments;
DROP POLICY IF EXISTS "Users can comment" ON public.comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON public.comments;
DROP POLICY IF EXISTS "Schedule is viewable" ON public.schedule_sessions;
DROP POLICY IF EXISTS "Admins can manage schedule" ON public.schedule_sessions;
DROP POLICY IF EXISTS "Users can view own schedule" ON public.user_schedule;
DROP POLICY IF EXISTS "Users can bookmark sessions" ON public.user_schedule;
DROP POLICY IF EXISTS "Users can remove bookmarks" ON public.user_schedule;
DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Receiver can mark as read" ON public.messages;
DROP POLICY IF EXISTS "Announcements are viewable" ON public.announcements;
DROP POLICY IF EXISTS "Admins can create announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admins can update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admins can delete announcements" ON public.announcements;
DROP POLICY IF EXISTS "Users see own notifications" ON public.notifications;
DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can mark as read" ON public.notifications;
DROP POLICY IF EXISTS "Point rules viewable" ON public.point_rules;
DROP POLICY IF EXISTS "Admins can manage point rules" ON public.point_rules;
DROP POLICY IF EXISTS "Users see own points" ON public.point_log;
DROP POLICY IF EXISTS "System can log points" ON public.point_log;
DROP POLICY IF EXISTS "Vendor booths viewable" ON public.vendor_booths;
DROP POLICY IF EXISTS "Admins manage booths" ON public.vendor_booths;
DROP POLICY IF EXISTS "Slots viewable" ON public.meeting_slots;
DROP POLICY IF EXISTS "Vendors manage slots" ON public.meeting_slots;
DROP POLICY IF EXISTS "Users see own bookings" ON public.meeting_bookings;
DROP POLICY IF EXISTS "Users can book" ON public.meeting_bookings;
DROP POLICY IF EXISTS "Users can cancel own bookings" ON public.meeting_bookings;
DROP POLICY IF EXISTS "Connections viewable" ON public.connections;
DROP POLICY IF EXISTS "Users can connect" ON public.connections;
DROP POLICY IF EXISTS "Users can disconnect" ON public.connections;
DROP POLICY IF EXISTS "Connection requests viewable" ON public.connection_requests;
DROP POLICY IF EXISTS "Users can send connection request" ON public.connection_requests;
DROP POLICY IF EXISTS "Requested user can update request" ON public.connection_requests;
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Event photos are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Event assets are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload event assets" ON storage.objects;

-- Helper: check if current user is admin for an event (avoids RLS recursion on event_members)
CREATE OR REPLACE FUNCTION public.is_event_admin(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = p_event_id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin')
  );
$$;

-- Helper: is current user a platform admin (app owner; can see/manage all events)
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT u.is_platform_admin FROM public.users u WHERE u.id = p_user_id),
    false
  );
$$;

-- USERS: everyone can read, users can update their own profile
CREATE POLICY "Users are viewable by everyone" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);

-- EVENTS: everyone can read active events; platform admins can read all (including inactive)
CREATE POLICY "Events are viewable by everyone" ON public.events FOR SELECT USING (
  is_active = true OR public.is_platform_admin(auth.uid())
);
-- Any authenticated user can create an event (creator becomes admin via trigger)
CREATE POLICY "Authenticated users can create events" ON public.events FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
-- Event admins or platform admin can update/delete events
CREATE POLICY "Admins can update events" ON public.events FOR UPDATE USING (
  public.is_platform_admin(auth.uid())
  OR EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = events.id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin'))
);
CREATE POLICY "Admins can delete events" ON public.events FOR DELETE USING (
  public.is_platform_admin(auth.uid())
  OR EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id = events.id AND em.user_id = auth.uid() AND em.role IN ('admin', 'super_admin'))
);

-- EVENT MEMBERS: viewable by members of the same event
CREATE POLICY "Members can view event members" ON public.event_members FOR SELECT USING (true);
CREATE POLICY "Users can join events" ON public.event_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can manage members" ON public.event_members FOR ALL USING (public.is_event_admin(event_id));
-- Users can update their own role to attendee/speaker/vendor (Profile "My role" self-selection)
CREATE POLICY "Users can update own role" ON public.event_members FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND role IN ('attendee', 'speaker', 'vendor'));

-- POSTS: viewable by event members, users create their own
CREATE POLICY "Posts are viewable by everyone" ON public.posts FOR SELECT USING (is_deleted = false);
CREATE POLICY "Users can create posts" ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage posts" ON public.posts FOR ALL USING (
    EXISTS (SELECT 1 FROM public.event_members WHERE user_id = auth.uid() AND event_id = posts.event_id AND role IN ('admin', 'super_admin'))
);

-- LIKES
CREATE POLICY "Likes are viewable" ON public.likes FOR SELECT USING (true);
CREATE POLICY "Users can like" ON public.likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unlike" ON public.likes FOR DELETE USING (auth.uid() = user_id);

-- COMMENTS
CREATE POLICY "Comments are viewable" ON public.comments FOR SELECT USING (true);
CREATE POLICY "Users can comment" ON public.comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own comments" ON public.comments FOR DELETE USING (auth.uid() = user_id);

-- SCHEDULE
CREATE POLICY "Schedule is viewable" ON public.schedule_sessions FOR SELECT USING (true);
CREATE POLICY "Admins can manage schedule" ON public.schedule_sessions FOR ALL USING (
    EXISTS (SELECT 1 FROM public.event_members WHERE user_id = auth.uid() AND event_id = schedule_sessions.event_id AND role IN ('admin', 'super_admin'))
);

-- USER SCHEDULE
CREATE POLICY "Users can view own schedule" ON public.user_schedule FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can bookmark sessions" ON public.user_schedule FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can remove bookmarks" ON public.user_schedule FOR DELETE USING (auth.uid() = user_id);

-- MESSAGES: only sender and receiver can see
CREATE POLICY "Users can view own messages" ON public.messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
CREATE POLICY "Users can send messages" ON public.messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Receiver can mark as read" ON public.messages FOR UPDATE USING (auth.uid() = receiver_id);

-- ANNOUNCEMENTS
CREATE POLICY "Announcements are viewable" ON public.announcements FOR SELECT USING (true);
CREATE POLICY "Admins can create announcements" ON public.announcements FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.event_members WHERE user_id = auth.uid() AND event_id = announcements.event_id AND role IN ('admin', 'super_admin'))
);
CREATE POLICY "Admins can update announcements" ON public.announcements FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.event_members WHERE user_id = auth.uid() AND event_id = announcements.event_id AND role IN ('admin', 'super_admin'))
);
CREATE POLICY "Admins can delete announcements" ON public.announcements FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.event_members WHERE user_id = auth.uid() AND event_id = announcements.event_id AND role IN ('admin', 'super_admin'))
);

-- NOTIFICATIONS
CREATE POLICY "Users see own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can create notifications" ON public.notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can mark as read" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

-- POINT RULES
CREATE POLICY "Point rules viewable" ON public.point_rules FOR SELECT USING (true);
CREATE POLICY "Admins can manage point rules" ON public.point_rules FOR ALL USING (
    EXISTS (SELECT 1 FROM public.event_members WHERE user_id = auth.uid() AND event_id = point_rules.event_id AND role IN ('admin', 'super_admin'))
);

-- POINT LOG
CREATE POLICY "Users see own points" ON public.point_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can log points" ON public.point_log FOR INSERT WITH CHECK (true);

-- VENDOR BOOTHS
CREATE POLICY "Vendor booths viewable" ON public.vendor_booths FOR SELECT USING (true);
CREATE POLICY "Admins manage booths" ON public.vendor_booths FOR ALL USING (
    EXISTS (SELECT 1 FROM public.event_members WHERE user_id = auth.uid() AND event_id = vendor_booths.event_id AND role IN ('admin', 'super_admin'))
);

-- MEETING SLOTS
CREATE POLICY "Slots viewable" ON public.meeting_slots FOR SELECT USING (true);
CREATE POLICY "Vendors manage slots" ON public.meeting_slots FOR ALL USING (
    EXISTS (SELECT 1 FROM public.vendor_booths vb JOIN public.event_members em ON em.event_id = vb.event_id WHERE vb.id = meeting_slots.booth_id AND em.user_id = auth.uid() AND em.role IN ('vendor', 'admin', 'super_admin'))
);

-- MEETING BOOKINGS
CREATE POLICY "Users see own bookings" ON public.meeting_bookings FOR SELECT USING (auth.uid() = attendee_id);
CREATE POLICY "Users can book" ON public.meeting_bookings FOR INSERT WITH CHECK (auth.uid() = attendee_id);
CREATE POLICY "Users can cancel own bookings" ON public.meeting_bookings FOR UPDATE USING (auth.uid() = attendee_id);

-- CONNECTIONS
CREATE POLICY "Connections viewable" ON public.connections FOR SELECT USING (auth.uid() = user_id OR auth.uid() = connected_user_id);
CREATE POLICY "Users can connect" ON public.connections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can disconnect" ON public.connections FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Connection requests viewable" ON public.connection_requests FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = requested_user_id);
CREATE POLICY "Users can send connection request" ON public.connection_requests FOR INSERT WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "Requested user can update request" ON public.connection_requests FOR UPDATE USING (auth.uid() = requested_user_id);


-- ============================================
-- STORAGE BUCKETS
-- ============================================
-- Skip if buckets already exist (safe to re-run)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('event-photos', 'event-photos', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('event-assets', 'event-assets', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Avatar images are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Users can upload avatars" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');
CREATE POLICY "Users can update own avatar" ON storage.objects FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Event photos are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'event-photos');
CREATE POLICY "Authenticated users can upload photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'event-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Event assets are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'event-assets');
CREATE POLICY "Admins can upload event assets" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'event-assets' AND auth.role() = 'authenticated');


-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-create user profile when they sign up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Auto-update likes_count on posts
CREATE OR REPLACE FUNCTION public.update_likes_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_like_change ON public.likes;
CREATE TRIGGER on_like_change
    AFTER INSERT OR DELETE ON public.likes
    FOR EACH ROW
    EXECUTE FUNCTION public.update_likes_count();

-- Auto-update comments_count on posts
CREATE OR REPLACE FUNCTION public.update_comments_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_comment_change ON public.comments;
CREATE TRIGGER on_comment_change
    AFTER INSERT OR DELETE ON public.comments
    FOR EACH ROW
    EXECUTE FUNCTION public.update_comments_count();

-- Auto-update points total on event_members
CREATE OR REPLACE FUNCTION public.update_member_points()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.event_members 
    SET points = points + NEW.points 
    WHERE user_id = NEW.user_id AND event_id = NEW.event_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_points_earned ON public.point_log;
CREATE TRIGGER on_points_earned
    AFTER INSERT ON public.point_log
    FOR EACH ROW
    EXECUTE FUNCTION public.update_member_points();

-- When a like is deleted, remove the points that were awarded for that like
-- (give_like for the liker, receive_like for the poster) and recalc event_members.points.
CREATE OR REPLACE FUNCTION public.remove_points_on_unlike()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_poster_id UUID;
BEGIN
  SELECT event_id, user_id INTO v_event_id, v_poster_id
  FROM public.posts WHERE id = OLD.post_id;

  IF v_event_id IS NULL OR v_poster_id IS NULL THEN
    RETURN OLD;
  END IF;

  DELETE FROM public.point_log
  WHERE user_id = OLD.user_id
    AND event_id = v_event_id
    AND action = 'give_like'
    AND reference_id = OLD.post_id;

  DELETE FROM public.point_log
  WHERE user_id = v_poster_id
    AND event_id = v_event_id
    AND action = 'receive_like'
    AND reference_id = OLD.id;

  UPDATE public.event_members em
  SET points = (
    SELECT COALESCE(SUM(pl.points), 0)::integer
    FROM public.point_log pl
    WHERE pl.user_id = em.user_id AND pl.event_id = em.event_id
  )
  WHERE em.event_id = v_event_id
    AND em.user_id IN (OLD.user_id, v_poster_id);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_like_deleted_remove_points ON public.likes;
CREATE TRIGGER on_like_deleted_remove_points
  AFTER DELETE ON public.likes
  FOR EACH ROW
  EXECUTE FUNCTION public.remove_points_on_unlike();

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_events_updated_at ON public.events;
CREATE TRIGGER update_events_updated_at
    BEFORE UPDATE ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

-- Generate unique event_code on INSERT if null (6-char alphanumeric)
CREATE OR REPLACE FUNCTION public.generate_event_code()
RETURNS TRIGGER AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INT;
  attempt INT := 0;
BEGIN
  IF NEW.event_code IS NULL OR NEW.event_code = '' THEN
    LOOP
      result := '';
      FOR i IN 1..6 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
      END LOOP;
      IF NOT EXISTS (SELECT 1 FROM public.events WHERE event_code = result) THEN
        NEW.event_code := result;
        EXIT;
      END IF;
      attempt := attempt + 1;
      IF attempt > 20 THEN
        NEW.event_code := result || substr(md5(gen_random_uuid()::text), 1, 2);
        EXIT;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_event_code_on_insert ON public.events;
CREATE TRIGGER set_event_code_on_insert
    BEFORE INSERT ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_event_code();

-- After creating an event, add the creator as admin
CREATE OR REPLACE FUNCTION public.add_creator_as_event_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.event_members (event_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'admin')
    ON CONFLICT (event_id, user_id) DO UPDATE SET role = 'admin';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS add_creator_as_admin_after_insert ON public.events;
CREATE TRIGGER add_creator_as_admin_after_insert
    AFTER INSERT ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.add_creator_as_event_admin();


-- ============================================
-- SEED DATA — Default point rules template
-- ============================================

-- You'll insert these when creating a new event
-- This is just a reference for the default values:
--
-- INSERT INTO public.point_rules (event_id, action, points_value, max_per_day, description) VALUES
-- ('EVENT_ID_HERE', 'post_photo', 25, 10, 'Post a photo'),
-- ('EVENT_ID_HERE', 'receive_like', 5, 50, 'Someone liked your post'),
-- ('EVENT_ID_HERE', 'give_like', 2, 30, 'Like someone else''s post'),
-- ('EVENT_ID_HERE', 'comment', 10, 20, 'Leave a comment'),
-- ('EVENT_ID_HERE', 'receive_comment', 5, 50, 'Someone commented on your post'),
-- ('EVENT_ID_HERE', 'connect', 15, 20, 'Connect with someone'),
-- ('EVENT_ID_HERE', 'attend_session', 20, 10, 'Attend a session'),
-- ('EVENT_ID_HERE', 'complete_profile', 30, 1, 'Complete your profile'),
-- ('EVENT_ID_HERE', 'daily_streak', 15, 1, 'Log in on consecutive days'),
-- ('EVENT_ID_HERE', 'vendor_meeting', 25, 10, 'Attend a vendor meeting'),
-- ('EVENT_ID_HERE', 'checkin', 15, 5, 'Check in via QR code'),
-- ('EVENT_ID_HERE', 'share_linkedin', 20, 5, 'Share to LinkedIn');


-- ============================================
-- ENABLE REALTIME (safe to re-run: adds only if not already in publication)
-- ============================================

DO $$
DECLARE
  t text;
  realtime_tables text[] := ARRAY['posts', 'likes', 'comments', 'messages', 'notifications', 'announcements', 'event_members', 'point_log'];
BEGIN
  FOREACH t IN ARRAY realtime_tables
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
