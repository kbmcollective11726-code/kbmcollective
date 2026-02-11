-- Block and Report feature
-- Run in Supabase SQL Editor

-- ==================
-- BLOCKED USERS
-- ==================
CREATE TABLE IF NOT EXISTS public.blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(blocker_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON public.blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON public.blocked_users(blocked_user_id);

-- RLS
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own blocks" ON public.blocked_users
  FOR SELECT USING (auth.uid() = blocker_id);

CREATE POLICY "Users can insert own blocks" ON public.blocked_users
  FOR INSERT WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "Users can delete own blocks" ON public.blocked_users
  FOR DELETE USING (auth.uid() = blocker_id);

-- ==================
-- USER REPORTS
-- ==================
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
CREATE INDEX IF NOT EXISTS idx_user_reports_created ON public.user_reports(created_at DESC);

-- RLS
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own reports" ON public.user_reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);

-- Admins can view reports (event admins - would need event context; for simplicity allow read of own reports)
CREATE POLICY "Users can view own reports" ON public.user_reports
  FOR SELECT USING (auth.uid() = reporter_id);
