-- ============================================
-- 4-DAY SCHEDULE TEST DATA
-- ============================================
-- Run in Supabase SQL Editor to add a full 4-day schedule for practice.
-- Targets the event named "CollectiveLive Demo Event" (create it with seed-event.sql first).
-- Times are in event timezone (America/New_York) so they display as 8 AM, 9 AM, etc.
-- To use a different timezone, change 'America/New_York' in the CTE below.
-- If you already ran an older version of this script, delete existing sessions for
-- this event first: DELETE FROM schedule_sessions WHERE event_id IN (SELECT id FROM events WHERE name = 'CollectiveLive Demo Event');
-- ============================================

-- Helper: "today" at midnight in event timezone, so 8 hours = 8:00 AM local
-- (CURRENT_DATE + 8 hours) was midnight UTC + 8h = 8 AM UTC, which showed as 3 AM in EST.
WITH event_day AS (
  SELECT (date_trunc('day', (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')) AT TIME ZONE 'America/New_York') AS day_start
)
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
  (d.day_start + s.start_offset)::timestamptz,
  (d.day_start + s.end_offset)::timestamptz,
  s.day_number,
  s.session_type,
  s.sort_order,
  true
FROM public.events e
CROSS JOIN (SELECT day_start FROM event_day) d
CROSS JOIN (
  VALUES
    -- DAY 1 (offsets from midnight Eastern)
    ('Conference Breakfast', 'Light breakfast and check-in.', NULL, NULL, 'Main Lobby', 'Lobby', INTERVAL '8 hours', INTERVAL '9 hours', 1, 'meal', 1),
    ('Opening Keynote', 'Welcome and vision for the event.', 'Jane Smith', 'CEO', 'Main Hall', 'Hall A', INTERVAL '9 hours', INTERVAL '10 hours', 1, 'keynote', 2),
    ('Networking & Coffee', 'Meet other attendees.', NULL, NULL, 'Lobby', NULL, INTERVAL '10 hours', INTERVAL '10 hours 30 minutes', 1, 'networking', 3),
    ('Breakout: Product Roadmap', 'Deep dive into product and Q&A.', 'Alex Chen', 'Product Lead', 'Room 101', 'Room 101', INTERVAL '10 hours 30 minutes', INTERVAL '11 hours 30 minutes', 1, 'breakout', 4),
    ('Breakout: Customer Success', 'Best practices from the field.', 'Maria Garcia', 'Customer Success', 'Room 102', 'Room 102', INTERVAL '10 hours 30 minutes', INTERVAL '11 hours 30 minutes', 1, 'breakout', 5),
    ('Lunch', 'Catered lunch in the main hall.', NULL, NULL, 'Main Hall', NULL, INTERVAL '12 hours', INTERVAL '13 hours', 1, 'meal', 6),
    ('Workshop: Hands-on Session', 'Bring your laptop.', 'Sam Wilson', 'Developer Advocate', 'Room 102', 'Room 102', INTERVAL '13 hours', INTERVAL '14 hours 30 minutes', 1, 'workshop', 7),
    ('Vendor Showcase', 'Meet our partners and sponsors.', NULL, NULL, 'Expo Hall', 'Expo', INTERVAL '14 hours 30 minutes', INTERVAL '16 hours', 1, 'vendor', 8),
    ('Day 1 Wrap & Social', 'Recap and casual networking.', NULL, NULL, 'Terrace', NULL, INTERVAL '16 hours', INTERVAL '17 hours 30 minutes', 1, 'social', 9),
    -- DAY 2
    ('Breakfast', 'Start day 2 with coffee and pastries.', NULL, NULL, 'Main Lobby', 'Lobby', INTERVAL '1 day 8 hours', INTERVAL '1 day 9 hours', 2, 'meal', 10),
    ('Day 2 Welcome', 'Recap and day 2 agenda.', 'Jane Smith', 'CEO', 'Main Hall', 'Hall A', INTERVAL '1 day 9 hours', INTERVAL '1 day 9 hours 30 minutes', 2, 'keynote', 11),
    ('Panel: Industry Trends', 'Experts discuss what''s next.', 'Panel', NULL, 'Main Hall', 'Hall A', INTERVAL '1 day 9 hours 30 minutes', INTERVAL '1 day 10 hours 30 minutes', 2, 'breakout', 12),
    ('Coffee Break', NULL, NULL, NULL, 'Lobby', NULL, INTERVAL '1 day 10 hours 30 minutes', INTERVAL '1 day 11 hours', 2, 'networking', 13),
    ('Workshop: Advanced Features', 'Technical deep dive.', 'Sam Wilson', 'Developer Advocate', 'Room 101', 'Room 101', INTERVAL '1 day 11 hours', INTERVAL '1 day 12 hours 30 minutes', 2, 'workshop', 14),
    ('Lunch & Learn', 'Quick talks over lunch.', NULL, NULL, 'Main Hall', NULL, INTERVAL '1 day 12 hours 30 minutes', INTERVAL '1 day 13 hours 30 minutes', 2, 'meal', 15),
    ('Breakout: Sales Strategies', 'Pipeline and closing tips.', 'Chris Lee', 'Sales VP', 'Room 102', 'Room 102', INTERVAL '1 day 13 hours 30 minutes', INTERVAL '1 day 14 hours 30 minutes', 2, 'breakout', 16),
    ('Networking Hour', 'Connect with peers.', NULL, NULL, 'Expo Hall', NULL, INTERVAL '1 day 14 hours 30 minutes', INTERVAL '1 day 15 hours 30 minutes', 2, 'networking', 17),
    -- DAY 3
    ('Morning Coffee', NULL, NULL, NULL, 'Lobby', 'Lobby', INTERVAL '2 days 8 hours', INTERVAL '2 days 8 hours 30 minutes', 3, 'meal', 18),
    ('Keynote: Future of Work', 'Where we''re headed.', 'Jordan Taylor', 'Chief Strategy Officer', 'Main Hall', 'Hall A', INTERVAL '2 days 9 hours', INTERVAL '2 days 10 hours', 3, 'keynote', 19),
    ('Breakout A: Marketing', 'Campaign best practices.', 'Riley Brown', 'Marketing Director', 'Room 101', 'Room 101', INTERVAL '2 days 10 hours 15 minutes', INTERVAL '2 days 11 hours 15 minutes', 3, 'breakout', 20),
    ('Breakout B: Engineering', 'Architecture and scale.', 'Morgan Davis', 'Engineering Lead', 'Room 102', 'Room 102', INTERVAL '2 days 10 hours 15 minutes', INTERVAL '2 days 11 hours 15 minutes', 3, 'breakout', 21),
    ('Lunch', 'Buffet in main hall.', NULL, NULL, 'Main Hall', NULL, INTERVAL '2 days 12 hours', INTERVAL '2 days 13 hours', 3, 'meal', 22),
    ('Workshop: Data & Analytics', 'Dashboards and reporting.', 'Alex Chen', 'Product Lead', 'Room 101', 'Room 101', INTERVAL '2 days 13 hours', INTERVAL '2 days 14 hours 30 minutes', 3, 'workshop', 23),
    ('Vendor Meetings', 'Book 1:1 with sponsors.', NULL, NULL, 'Expo Hall', 'Expo', INTERVAL '2 days 14 hours 30 minutes', INTERVAL '2 days 16 hours', 3, 'vendor', 24),
    ('Evening Social', 'Dinner and drinks.', NULL, NULL, 'Terrace', NULL, INTERVAL '2 days 17 hours', INTERVAL '2 days 19 hours', 3, 'social', 25),
    -- DAY 4
    ('Breakfast', 'Final day kickoff.', NULL, NULL, 'Main Lobby', 'Lobby', INTERVAL '3 days 8 hours', INTERVAL '3 days 9 hours', 4, 'meal', 26),
    ('Closing Keynote', 'Recap and next steps.', 'Jane Smith', 'CEO', 'Main Hall', 'Hall A', INTERVAL '3 days 9 hours', INTERVAL '3 days 10 hours', 4, 'keynote', 27),
    ('Breakout: Roadmap Q&A', 'Open Q&A with product.', 'Alex Chen', 'Product Lead', 'Main Hall', 'Hall A', INTERVAL '3 days 10 hours 15 minutes', INTERVAL '3 days 11 hours 15 minutes', 4, 'breakout', 28),
    ('Prize Draw & Closing', 'Raffle and thank you.', NULL, NULL, 'Main Hall', 'Hall A', INTERVAL '3 days 11 hours 30 minutes', INTERVAL '3 days 12 hours', 4, 'social', 29),
    ('Farewell Lunch', 'See you next time!', NULL, NULL, 'Main Hall', NULL, INTERVAL '3 days 12 hours', INTERVAL '3 days 13 hours', 4, 'meal', 30)
) AS s(title, description, speaker_name, speaker_title, location, room, start_offset, end_offset, day_number, session_type, sort_order)
WHERE e.name = 'CollectiveLive Demo Event'
  AND NOT EXISTS (
    SELECT 1 FROM public.schedule_sessions ss
    WHERE ss.event_id = e.id
      AND ss.title = s.title
      AND ss.start_time = (d.day_start + s.start_offset)::timestamptz
  );
