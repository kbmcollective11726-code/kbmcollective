-- Allow users to update their own event_members.role to attendee, speaker, or vendor.
-- Admins can still manage any member via "Admins can manage members" policy.
-- This enables the Profile "My role" self-selection feature.
--
-- Run in Supabase SQL Editor if you have an existing deployment.

DROP POLICY IF EXISTS "Users can update own role" ON public.event_members;
CREATE POLICY "Users can update own role" ON public.event_members
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND role IN ('attendee', 'speaker', 'vendor')
  );
