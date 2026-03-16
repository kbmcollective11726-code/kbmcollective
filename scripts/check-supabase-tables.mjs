#!/usr/bin/env node
/**
 * Check Supabase tables and columns. Requires DATABASE_URL in .env.
 * Usage: node scripts/check-supabase-tables.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

loadEnv();
const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL or SUPABASE_DB_URL in .env');
  console.error('Get it from: Supabase Dashboard → Project Settings → Database → Connection string (URI)');
  process.exit(1);
}

const tablesQuery = `
SELECT
  t.table_name AS "Table",
  CASE WHEN t.table_name IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS "Status"
FROM (
  SELECT unnest(ARRAY[
    'users', 'events', 'event_members', 'posts', 'likes', 'comments',
    'messages', 'notifications', 'announcements',
    'schedule_sessions', 'user_schedule', 'point_rules', 'point_log',
    'connections', 'connection_requests', 'blocked_users', 'user_reports',
    'chat_groups', 'chat_group_members', 'group_messages',
    'session_reminder_sent', 'vendor_booths', 'meeting_slots', 'meeting_bookings'
  ]) AS table_name
) required
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = required.table_name
ORDER BY "Status" DESC, "Table";
`;

const columnsQuery = `
WITH required AS (
  SELECT 'users' AS tname, unnest(ARRAY['id','email','full_name','push_token','is_platform_admin']) AS cname
  UNION ALL SELECT 'events', unnest(ARRAY['id','name','event_code','is_active'])
  UNION ALL SELECT 'event_members', unnest(ARRAY['event_id','user_id','role','roles','points'])
  UNION ALL SELECT 'posts', unnest(ARRAY['id','event_id','user_id','image_url','is_approved','is_deleted'])
  UNION ALL SELECT 'messages', unnest(ARRAY['id','event_id','sender_id','receiver_id','content','attachment_url','attachment_type'])
  UNION ALL SELECT 'notifications', unnest(ARRAY['id','user_id','event_id','type','title','body','data','is_read'])
  UNION ALL SELECT 'chat_groups', unnest(ARRAY['id','event_id','name','created_by'])
  UNION ALL SELECT 'chat_group_members', unnest(ARRAY['id','group_id','user_id'])
  UNION ALL SELECT 'group_messages', unnest(ARRAY['id','group_id','sender_id','content','attachment_url'])
  UNION ALL SELECT 'announcements', unnest(ARRAY['id','event_id','title','content','scheduled_at','sent_at','send_push','sent_by'])
  UNION ALL SELECT 'schedule_sessions', unnest(ARRAY['id','event_id','title','start_time','is_active'])
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
`;

async function run() {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();

    console.log('\n--- Tables ---');
    const tablesRes = await client.query(tablesQuery);
    const missing = tablesRes.rows.filter((r) => r.Status === 'MISSING');
    tablesRes.rows.forEach((r) => console.log(`  ${r.Table ?? 'unknown'}: ${r.Status}`));

    if (missing.length) {
      console.log(`\n  ⚠ ${missing.length} table(s) MISSING: ${missing.map((r) => r.Table).join(', ')}`);
    } else {
      console.log('\n  ✓ All 24 required tables exist.');
    }

    console.log('\n--- Missing columns (empty = all good) ---');
    const colsRes = await client.query(columnsQuery);
    if (colsRes.rows.length === 0) {
      console.log('  ✓ No missing columns.');
    } else {
      colsRes.rows.forEach((r) => console.log(`  ${r.Table}: missing "${r['Missing column']}"`));
      console.log(`\n  ⚠ ${colsRes.rows.length} missing column(s). Run: npm run supabase:run-sql`);
    }

    console.log('');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
