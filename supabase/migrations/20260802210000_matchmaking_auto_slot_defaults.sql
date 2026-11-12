-- Auto-schedule defaults used when Matching & approve creates day slots.
ALTER TABLE public.event_matchmaking_settings
  ADD COLUMN IF NOT EXISTS default_meeting_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (default_meeting_minutes >= 5 AND default_meeting_minutes <= 180),
  ADD COLUMN IF NOT EXISTS auto_slot_start_hour INTEGER NOT NULL DEFAULT 9
    CHECK (auto_slot_start_hour >= 0 AND auto_slot_start_hour <= 23),
  ADD COLUMN IF NOT EXISTS auto_slot_end_hour INTEGER NOT NULL DEFAULT 17
    CHECK (auto_slot_end_hour >= 1 AND auto_slot_end_hour <= 24);

COMMENT ON COLUMN public.event_matchmaking_settings.default_meeting_minutes IS
  'Default 1:1 duration in minutes for auto-generated time slots.';
COMMENT ON COLUMN public.event_matchmaking_settings.auto_slot_start_hour IS
  'Wall-clock hour (0-23) when auto-generated meeting days begin.';
COMMENT ON COLUMN public.event_matchmaking_settings.auto_slot_end_hour IS
  'Wall-clock hour (1-24) when auto-generated meeting days end (exclusive).';
