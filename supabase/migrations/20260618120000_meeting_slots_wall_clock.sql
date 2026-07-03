-- Convert meeting_slots from real UTC instants to wall-clock UTC (same model as schedule_sessions).
-- Example: 1:05 PM Pacific was stored as 20:05 UTC → becomes 13:05 UTC so display matches agenda.

UPDATE public.meeting_slots ms
SET
  start_time = ((ms.start_time AT TIME ZONE COALESCE(NULLIF(trim(e.reminder_timezone), ''), 'America/New_York')) AT TIME ZONE 'UTC'),
  end_time = ((ms.end_time AT TIME ZONE COALESCE(NULLIF(trim(e.reminder_timezone), ''), 'America/New_York')) AT TIME ZONE 'UTC')
FROM public.vendor_booths vb
JOIN public.events e ON e.id = vb.event_id
WHERE vb.id = ms.booth_id;

COMMENT ON COLUMN public.meeting_slots.start_time IS
  'Wall-clock UTC (same as schedule_sessions): UTC H:M equals venue clock shown in app/admin.';
