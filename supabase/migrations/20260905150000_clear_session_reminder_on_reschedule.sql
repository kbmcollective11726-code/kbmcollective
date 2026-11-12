-- When a session's start_time changes (e.g. preview schedule moved to new dates),
-- clear the one-shot reminder marker so notify-event-starting-soon can fire again.
CREATE OR REPLACE FUNCTION public.clear_session_reminder_sent_on_start_time_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    DELETE FROM public.session_reminder_sent WHERE session_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_session_reminder_sent_on_start_time_change
  ON public.schedule_sessions;

CREATE TRIGGER trg_clear_session_reminder_sent_on_start_time_change
  AFTER UPDATE OF start_time ON public.schedule_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_session_reminder_sent_on_start_time_change();

COMMENT ON FUNCTION public.clear_session_reminder_sent_on_start_time_change() IS
  'Clears session_reminder_sent when schedule_sessions.start_time changes so reminders can re-fire.';
