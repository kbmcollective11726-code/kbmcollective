-- Admin toggle: one_step (full form on public register) vs two_step (Stage 1 then portal Stage 2).
ALTER TABLE public.event_matchmaking_settings
  ADD COLUMN IF NOT EXISTS registration_flow_mode text NOT NULL DEFAULT 'two_step';

ALTER TABLE public.event_matchmaking_settings
  DROP CONSTRAINT IF EXISTS event_matchmaking_settings_registration_flow_mode_check;

ALTER TABLE public.event_matchmaking_settings
  ADD CONSTRAINT event_matchmaking_settings_registration_flow_mode_check
  CHECK (registration_flow_mode IN ('one_step', 'two_step'));

COMMENT ON COLUMN public.event_matchmaking_settings.registration_flow_mode IS
  'one_step = account + full form on public register; two_step = Stage 1 public then Stage 2 portal profile';
