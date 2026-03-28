-- ============================================================
-- CHECK ALL REQUIRED TABLES AND COLUMNS
-- Run in Supabase Dashboard → SQL Editor. Copy entire file and Run.
-- Result 1: each required table → OK or MISSING TABLE
-- Result 2: any missing critical columns (empty = all present)
-- ============================================================

-- ---------- 1) Required tables ----------
SELECT
  t.table_name AS "Table",
  CASE WHEN t.table_name IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS "Status"
FROM (
  SELECT unnest(ARRAY[
    'users', 'events', 'event_members', 'posts', 'likes', 'comments',
    'messages', 'notifications', 'announcements',
    'schedule_sessions', 'user_schedule', 'point_rules', 'point_log',
    'connections', 'connection_requests', 'blocked_users', 'user_reports',
    'chat_groups', 'chat_group_members', 'group_messages', 'chat_group_event',
    'session_reminder_sent', 'vendor_booths', 'meeting_slots', 'meeting_bookings',
    'session_ratings',
    'b2b_meeting_feedback', 'b2b_meeting_feedback_nudge_sent', 'b2b_meeting_reminder_sent'
  ]) AS table_name
) required
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = required.table_name
ORDER BY "Status" DESC, "Table";

-- ---------- 2) Critical columns (only report MISSING) ----------
-- If this returns 0 rows, all required columns exist.
WITH required AS (
  SELECT 'users' AS tname, unnest(ARRAY['id','email','full_name','push_token','is_platform_admin']) AS cname
  UNION ALL SELECT 'events', unnest(ARRAY['id','name','event_code','is_active'])
  UNION ALL SELECT 'event_members', unnest(ARRAY['event_id','user_id','role','roles','points'])
  UNION ALL SELECT 'posts', unnest(ARRAY['id','event_id','user_id','image_url','is_approved','is_deleted'])
  UNION ALL SELECT 'messages', unnest(ARRAY['id','event_id','sender_id','receiver_id','content','attachment_url','attachment_type'])
  UNION ALL SELECT 'notifications', unnest(ARRAY['id','user_id','event_id','type','title','body','data','is_read'])
  UNION ALL SELECT 'chat_groups', unnest(ARRAY['id','event_id','name','created_by'])
  UNION ALL SELECT 'chat_group_members', unnest(ARRAY['id','group_id','user_id'])
  UNION ALL SELECT 'group_messages', unnest(ARRAY['id','group_id','sender_id','content','attachment_url','attachment_type'])
  UNION ALL SELECT 'likes', unnest(ARRAY['post_id','user_id'])
  UNION ALL SELECT 'comments', unnest(ARRAY['id','post_id','user_id','content'])
  UNION ALL SELECT 'user_schedule', unnest(ARRAY['user_id','session_id'])
  UNION ALL SELECT 'point_log', unnest(ARRAY['id','user_id','event_id','action','points'])
  UNION ALL SELECT 'user_reports', unnest(ARRAY['id','reporter_id','reported_user_id'])
  UNION ALL SELECT 'announcements', unnest(ARRAY['id','event_id','title','content','scheduled_at','sent_at','send_push','sent_by'])
  UNION ALL SELECT 'schedule_sessions', unnest(ARRAY['id','event_id','title','start_time','end_time','day_number','is_active'])
  UNION ALL SELECT 'vendor_booths', unnest(ARRAY['id','event_id','vendor_name','contact_user_id','is_active'])
  UNION ALL SELECT 'meeting_slots', unnest(ARRAY['id','booth_id','start_time','end_time'])
  UNION ALL SELECT 'meeting_bookings', unnest(ARRAY['id','slot_id','attendee_id','status'])
  UNION ALL SELECT 'session_ratings', unnest(ARRAY['id','session_id','event_id','user_id','rating'])
  UNION ALL SELECT 'chat_group_event', unnest(ARRAY['group_id','event_id'])
  UNION ALL SELECT 'b2b_meeting_feedback', unnest(ARRAY['id','booking_id','user_id','rating'])
  UNION ALL SELECT 'b2b_meeting_reminder_sent', unnest(ARRAY['booking_id'])
  UNION ALL SELECT 'b2b_meeting_feedback_nudge_sent', unnest(ARRAY['booking_id'])
  UNION ALL SELECT 'point_rules', unnest(ARRAY['id','event_id','action','points_value'])
  UNION ALL SELECT 'connections', unnest(ARRAY['event_id','user_id','connected_user_id'])
  UNION ALL SELECT 'connection_requests', unnest(ARRAY['event_id','requester_id','requested_user_id','status'])
  UNION ALL SELECT 'blocked_users', unnest(ARRAY['blocker_id','blocked_user_id'])
)
SELECT r.tname AS "Table", r.cname AS "Missing column"
FROM required r
WHERE EXISTS (SELECT 1 FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_name = r.tname)
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = r.tname AND c.column_name = r.cname)
ORDER BY r.tname, r.cname;
