-- Phone-scheduled "starting soon" alarms.
-- The app sets alarms on the phone and records when (local_reminders_at) and how far ahead
-- (local_reminders_until). Reminder crons skip the push for an item when the phone's alarms were set
-- after the item last changed (reminder_changed_at) and cover its start time; otherwise they push as before.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS local_reminders_at timestamptz,
  ADD COLUMN IF NOT EXISTS local_reminders_until timestamptz;

COMMENT ON COLUMN public.users.local_reminders_at IS
  'When the app last scheduled phone alarms from live data (null = no phone alarms).';
COMMENT ON COLUMN public.users.local_reminders_until IS
  'Start time of the furthest item covered by the phone alarms.';

GRANT SELECT (local_reminders_at, local_reminders_until) ON TABLE public.users TO authenticated;
GRANT UPDATE (local_reminders_at, local_reminders_until) ON TABLE public.users TO authenticated;

ALTER TABLE public.meeting_slots
  ADD COLUMN IF NOT EXISTS reminder_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.meeting_bookings
  ADD COLUMN IF NOT EXISTS reminder_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.schedule_sessions
  ADD COLUMN IF NOT EXISTS reminder_changed_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.touch_slot_reminder_changed_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
     OR NEW.booth_id IS DISTINCT FROM OLD.booth_id THEN
    NEW.reminder_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_booking_reminder_changed_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.slot_id IS DISTINCT FROM OLD.slot_id
     OR NEW.attendee_id IS DISTINCT FROM OLD.attendee_id
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.reminder_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_session_reminder_changed_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.day_number IS DISTINCT FROM OLD.day_number
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.location IS DISTINCT FROM OLD.location
     OR NEW.room IS DISTINCT FROM OLD.room
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.reminder_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_slot_reminder_changed_at ON public.meeting_slots;
CREATE TRIGGER trg_slot_reminder_changed_at
  BEFORE UPDATE ON public.meeting_slots
  FOR EACH ROW EXECUTE FUNCTION public.touch_slot_reminder_changed_at();

DROP TRIGGER IF EXISTS trg_booking_reminder_changed_at ON public.meeting_bookings;
CREATE TRIGGER trg_booking_reminder_changed_at
  BEFORE UPDATE ON public.meeting_bookings
  FOR EACH ROW EXECUTE FUNCTION public.touch_booking_reminder_changed_at();

DROP TRIGGER IF EXISTS trg_session_reminder_changed_at ON public.schedule_sessions;
CREATE TRIGGER trg_session_reminder_changed_at
  BEFORE UPDATE ON public.schedule_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_session_reminder_changed_at();
