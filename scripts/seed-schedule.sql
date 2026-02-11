-- ============================================
-- Seed schedule sessions for the demo event
-- Run after seed-event.sql (creates the event).
-- Run once in Supabase SQL Editor.
-- ============================================

INSERT INTO public.schedule_sessions (
  event_id,
  title,
  description,
  speaker_name,
  speaker_title,
  location,
  room,
  start_time,
  end_time,
  day_number,
  session_type,
  sort_order,
  is_active
)
SELECT
  e.id,
  s.title,
  s.description,
  s.speaker_name,
  s.speaker_title,
  s.location,
  s.room,
  s.start_time,
  s.end_time,
  s.day_number,
  s.session_type,
  s.sort_order,
  true
FROM public.events e
CROSS JOIN (
  VALUES
    ('Opening Keynote', 'Kick off the event with key announcements and vision.', 'Jane Smith', 'CEO', 'Main Hall', 'Hall A', (CURRENT_DATE + INTERVAL '9 hours')::timestamptz, (CURRENT_DATE + INTERVAL '10 hours')::timestamptz, 1, 'keynote', 1),
    ('Networking & Coffee', 'Meet other attendees and grab a coffee.', NULL, NULL, 'Lobby', NULL, (CURRENT_DATE + INTERVAL '10 hours')::timestamptz, (CURRENT_DATE + INTERVAL '10 hours 30 minutes')::timestamptz, 1, 'networking', 2),
    ('Breakout: Product Deep Dive', 'Deep dive into our product roadmap and Q&A.', 'Alex Chen', 'Product Lead', 'Room 101', 'Room 101', (CURRENT_DATE + INTERVAL '10 hours 30 minutes')::timestamptz, (CURRENT_DATE + INTERVAL '11 hours 30 minutes')::timestamptz, 1, 'breakout', 3),
    ('Lunch', 'Catered lunch in the main hall.', NULL, NULL, 'Main Hall', NULL, (CURRENT_DATE + INTERVAL '12 hours')::timestamptz, (CURRENT_DATE + INTERVAL '13 hours')::timestamptz, 1, 'meal', 4),
    ('Workshop: Hands-on Session', 'Bring your laptop for a hands-on workshop.', 'Sam Wilson', 'Developer Advocate', 'Room 102', 'Room 102', (CURRENT_DATE + INTERVAL '13 hours')::timestamptz, (CURRENT_DATE + INTERVAL '14 hours 30 minutes')::timestamptz, 1, 'workshop', 5),
    ('Day 2 Welcome', 'Recap and day 2 agenda.', 'Jane Smith', 'CEO', 'Main Hall', 'Hall A', (CURRENT_DATE + INTERVAL '1 day 9 hours')::timestamptz, (CURRENT_DATE + INTERVAL '1 day 9 hours 30 minutes')::timestamptz, 2, 'keynote', 10),
    ('Panel Discussion', 'Industry experts discuss trends.', 'Panel', NULL, 'Main Hall', 'Hall A', (CURRENT_DATE + INTERVAL '1 day 9 hours 30 minutes')::timestamptz, (CURRENT_DATE + INTERVAL '1 day 10 hours 30 minutes')::timestamptz, 2, 'breakout', 11)
) AS s(title, description, speaker_name, speaker_title, location, room, start_time, end_time, day_number, session_type, sort_order)
WHERE e.name = 'CollectiveLive Demo Event'
  AND NOT EXISTS (
    SELECT 1 FROM public.schedule_sessions ss
    WHERE ss.event_id = e.id AND ss.title = s.title
  );
