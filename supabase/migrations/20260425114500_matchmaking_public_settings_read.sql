-- Allow public/anon reads of "open" matchmaking settings rows only.
-- This is required because other public registration policies reference
-- event_matchmaking_settings in EXISTS clauses; without a SELECT policy
-- those checks always fail under RLS for anon users.

DROP POLICY IF EXISTS "Public read open matchmaking settings" ON public.event_matchmaking_settings;
CREATE POLICY "Public read open matchmaking settings" ON public.event_matchmaking_settings
  FOR SELECT
  USING (registration_open = true);
