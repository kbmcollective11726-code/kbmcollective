-- ============================================
-- KBM EVENT — 4-DAY SCHEDULE (Feb 11–14)
-- ============================================
-- Agenda for the KBM event from February 11 to 14.
-- Run in Supabase SQL Editor.
--
-- 1. Ensure you have an event for this schedule. If your event has a different
--    name, change the WHERE clauses below (both DELETE and INSERT).
-- 2. This script DELETES existing schedule sessions for the KBM event, then inserts the new agenda.
-- ============================================

-- Delete existing schedule for KBM event(s)
DELETE FROM public.schedule_sessions
WHERE event_id IN (
  SELECT id FROM public.events
  WHERE (name ILIKE '%KBM%' OR name = 'KBM Event')
    AND start_date <= '2026-02-11'::date
    AND end_date >= '2026-02-14'::date
);

-- Base: Feb 11–14, day_number 1–4
WITH kbm_days AS (
  SELECT
    ('2026-02-11'::date + (n - 1) * INTERVAL '1 day')::date AS day_date,
    n AS day_number
  FROM generate_series(1, 4) AS n
),
day_starts AS (
  SELECT
    day_number,
    (day_date::timestamp AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC' AS day_start_utc
  FROM kbm_days
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
  d.day_start_utc + s.start_offset,
  d.day_start_utc + s.end_offset,
  d.day_number,
  s.session_type,
  s.sort_order,
  true
FROM public.events e
CROSS JOIN day_starts d
JOIN (
  VALUES
    -- DAY 1 (Feb 11) — offsets from midnight Eastern
    ('Conference Breakfast', 'Check-in and light breakfast.', NULL, NULL, 'Main Lobby', 'Lobby', INTERVAL '8 hours', INTERVAL '9 hours', 1, 'meal', 1),
    ('Opening Keynote', 'Welcome and vision for the event.', 'Jane Smith', 'CEO', 'Main Hall', 'Hall A', INTERVAL '9 hours', INTERVAL '10 hours', 1, 'keynote', 2),
    ('Networking & Coffee', 'Meet other attendees.', NULL, NULL, 'Lobby', NULL, INTERVAL '10 hours', INTERVAL '10 hours 30 minutes', 1, 'networking', 3),
    ('Breakout: Product Roadmap', 'Deep dive and Q&A.', 'Alex Chen', 'Product Lead', 'Room 101', 'Room 101', INTERVAL '10 hours 30 minutes', INTERVAL '11 hours 30 minutes', 1, 'breakout', 4),
    ('Breakout: Customer Success', 'Best practices from the field.', 'Maria Garcia', 'Customer Success', 'Room 102', 'Room 102', INTERVAL '10 hours 30 minutes', INTERVAL '11 hours 30 minutes', 1, 'breakout', 5),
    ('Lunch', 'Catered lunch in the main hall.', NULL, NULL, 'Main Hall', NULL, INTERVAL '12 hours', INTERVAL '13 hours', 1, 'meal', 6),
    ('Workshop: Hands-on Session', 'Bring your laptop.', 'Sam Wilson', 'Developer Advocate', 'Room 102', 'Room 102', INTERVAL '13 hours', INTERVAL '14 hours 30 minutes', 1, 'workshop', 7),
    ('Vendor Showcase', 'Meet partners and sponsors.', NULL, NULL, 'Expo Hall', 'Expo', INTERVAL '14 hours 30 minutes', INTERVAL '16 hours', 1, 'vendor', 8),
    ('Day 1 Wrap & Social', 'Recap and networking.', NULL, NULL, 'Terrace', NULL, INTERVAL '16 hours', INTERVAL '17 hours 30 minutes', 1, 'social', 9),
    -- DAY 2 (Feb 12)
    ('Breakfast', 'Coffee and pastries.', NULL, NULL, 'Main Lobby', 'Lobby', INTERVAL '8 hours', INTERVAL '9 hours', 2, 'meal', 10),
    ('Day 2 Welcome', 'Recap and day 2 agenda.', 'Jane Smith', 'CEO', 'Main Hall', 'Hall A', INTERVAL '9 hours', INTERVAL '9 hours 30 minutes', 2, 'keynote', 11),
    ('Panel: Industry Trends', 'Experts discuss what''s next.', 'Panel', NULL, 'Main Hall', 'Hall A', INTERVAL '9 hours 30 minutes', INTERVAL '10 hours 30 minutes', 2, 'breakout', 12),
    ('Coffee Break', NULL, NULL, NULL, 'Lobby', NULL, INTERVAL '10 hours 30 minutes', INTERVAL '11 hours', 2, 'networking', 13),
    ('Workshop: Advanced Features', 'Technical deep dive.', 'Sam Wilson', 'Developer Advocate', 'Room 101', 'Room 101', INTERVAL '11 hours', INTERVAL '12 hours 30 minutes', 2, 'workshop', 14),
    ('Lunch & Learn', 'Quick talks over lunch.', NULL, NULL, 'Main Hall', NULL, INTERVAL '12 hours 30 minutes', INTERVAL '13 hours 30 minutes', 2, 'meal', 15),
    ('Breakout: Sales Strategies', 'Pipeline and closing tips.', 'Chris Lee', 'Sales VP', 'Room 102', 'Room 102', INTERVAL '13 hours 30 minutes', INTERVAL '14 hours 30 minutes', 2, 'breakout', 16),
    ('Networking Hour', 'Connect with peers.', NULL, NULL, 'Expo Hall', NULL, INTERVAL '14 hours 30 minutes', INTERVAL '15 hours 30 minutes', 2, 'networking', 17),
    -- DAY 3 (Feb 13)
    ('Morning Coffee', NULL, NULL, NULL, 'Lobby', 'Lobby', INTERVAL '8 hours', INTERVAL '8 hours 30 minutes', 3, 'meal', 18),
    ('Keynote: Future of Work', 'Where we''re headed.', 'Jordan Taylor', 'Chief Strategy Officer', 'Main Hall', 'Hall A', INTERVAL '9 hours', INTERVAL '10 hours', 3, 'keynote', 19),
    ('Breakout A: Marketing', 'Campaign best practices.', 'Riley Brown', 'Marketing Director', 'Room 101', 'Room 101', INTERVAL '10 hours 15 minutes', INTERVAL '11 hours 15 minutes', 3, 'breakout', 20),
    ('Breakout B: Engineering', 'Architecture and scale.', 'Morgan Davis', 'Engineering Lead', 'Room 102', 'Room 102', INTERVAL '10 hours 15 minutes', INTERVAL '11 hours 15 minutes', 3, 'breakout', 21),
    ('Lunch', 'Buffet in main hall.', NULL, NULL, 'Main Hall', NULL, INTERVAL '12 hours', INTERVAL '13 hours', 3, 'meal', 22),
    ('Workshop: Data & Analytics', 'Dashboards and reporting.', 'Alex Chen', 'Product Lead', 'Room 101', 'Room 101', INTERVAL '13 hours', INTERVAL '14 hours 30 minutes', 3, 'workshop', 23),
    ('Vendor Meetings', 'Book 1:1 with sponsors.', NULL, NULL, 'Expo Hall', 'Expo', INTERVAL '14 hours 30 minutes', INTERVAL '16 hours', 3, 'vendor', 24),
    ('Evening Social', 'Dinner and drinks.', NULL, NULL, 'Terrace', NULL, INTERVAL '17 hours', INTERVAL '19 hours', 3, 'social', 25),
    -- DAY 4 (Feb 14)
    ('Breakfast', 'Final day kickoff.', NULL, NULL, 'Main Lobby', 'Lobby', INTERVAL '8 hours', INTERVAL '9 hours', 4, 'meal', 26),
    ('Closing Keynote', 'Recap and next steps.', 'Jane Smith', 'CEO', 'Main Hall', 'Hall A', INTERVAL '9 hours', INTERVAL '10 hours', 4, 'keynote', 27),
    ('Breakout: Roadmap Q&A', 'Open Q&A with product.', 'Alex Chen', 'Product Lead', 'Main Hall', 'Hall A', INTERVAL '10 hours 15 minutes', INTERVAL '11 hours 15 minutes', 4, 'breakout', 28),
    ('Prize Draw & Closing', 'Raffle and thank you.', NULL, NULL, 'Main Hall', 'Hall A', INTERVAL '11 hours 30 minutes', INTERVAL '12 hours', 4, 'social', 29),
    ('Farewell Lunch', 'See you next time!', NULL, NULL, 'Main Hall', NULL, INTERVAL '12 hours', INTERVAL '13 hours', 4, 'meal', 30)
) AS s(title, description, speaker_name, speaker_title, location, room, start_offset, end_offset, day_number, session_type, sort_order)
  ON d.day_number = s.day_number
WHERE (e.name ILIKE '%KBM%' OR e.name = 'KBM Event')
  AND e.start_date <= '2026-02-11'::date
  AND e.end_date >= '2026-02-14'::date
  AND NOT EXISTS (
    SELECT 1 FROM public.schedule_sessions ss
    WHERE ss.event_id = e.id
      AND ss.title = s.title
      AND ss.day_number = d.day_number
  );
