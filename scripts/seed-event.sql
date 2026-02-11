-- ============================================
-- CREATE A TEST EVENT (run once in Supabase)
-- ============================================
-- 1. Open Supabase Dashboard → your project → SQL Editor
-- 2. New query → paste this ENTIRE file → Run
-- 3. Open the app → Info tab → tap "Event" → you'll see "CollectiveLive Demo Event" → tap to join

DO $$
DECLARE
  new_event_id UUID;
BEGIN
  INSERT INTO public.events (
    name,
    description,
    location,
    start_date,
    end_date,
    theme_color,
    welcome_message,
    is_active
  ) VALUES (
    'CollectiveLive Demo Event',
    'A sample event to try the app. Share photos, earn points, and climb the leaderboard!',
    'Your venue',
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '2 days',
    '#2563eb',
    'Welcome! Post photos and connect with others.',
    true
  )
  RETURNING id INTO new_event_id;

  INSERT INTO public.point_rules (event_id, action, points_value, max_per_day, description) VALUES
  (new_event_id, 'post_photo', 15, 10, 'Post a photo'),
  (new_event_id, 'receive_like', 5, 50, 'Someone liked your post'),
  (new_event_id, 'give_like', 5, 30, 'Like someone else''s post'),
  (new_event_id, 'comment', 10, 20, 'Leave a comment'),
  (new_event_id, 'receive_comment', 5, 50, 'Someone commented on your post'),
  (new_event_id, 'connect', 15, 20, 'Connect with someone'),
  (new_event_id, 'attend_session', 20, 10, 'Attend a session'),
  (new_event_id, 'complete_profile', 30, 1, 'Complete your profile'),
  (new_event_id, 'daily_streak', 15, 1, 'Daily login streak'),
  (new_event_id, 'vendor_meeting', 25, 10, 'Vendor meeting'),
  (new_event_id, 'checkin', 15, 5, 'Check in'),
  (new_event_id, 'share_linkedin', 20, 5, 'Share to LinkedIn');
END $$;
