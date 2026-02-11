-- Connection requests: user must accept before connection is created
-- Run this on your Supabase project (SQL Editor or migration) if you already have connections table.

CREATE TABLE IF NOT EXISTS public.connection_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    requester_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    requested_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, requester_id, requested_user_id)
);

ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Connection requests viewable" ON public.connection_requests;
DROP POLICY IF EXISTS "Users can send connection request" ON public.connection_requests;
DROP POLICY IF EXISTS "Requested user can update request" ON public.connection_requests;

CREATE POLICY "Connection requests viewable" ON public.connection_requests FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = requested_user_id);
CREATE POLICY "Users can send connection request" ON public.connection_requests FOR INSERT WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "Requested user can update request" ON public.connection_requests FOR UPDATE USING (auth.uid() = requested_user_id);
