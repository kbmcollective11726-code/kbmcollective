#!/usr/bin/env node
/**
 * Quick script to verify Supabase setup via REST API.
 * Run: node scripts/check-supabase.mjs  (or: node --env-file=.env scripts/check-supabase.mjs)
 * Requires .env with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envPath = resolve(__dirname, '..', '.env');
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      process.env[k] = v;
    }
  }
} catch (e) {
  console.error('Could not load .env:', e.message);
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

async function get(path) {
  const res = await fetch(`${url}/rest/v1${path}`, { headers });
  return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : await res.text() };
}

async function main() {
  console.log('Checking Supabase setup for', url.replace(/https?:\/\//, '').split('.')[0], '...\n');

  // 1. Health / reachability
  try {
    const health = await fetch(`${url}/rest/v1/`, { headers });
    console.log('1. API reachable:', health.ok ? '✓' : '✗', health.status);
  } catch (e) {
    console.log('1. API reachable: ✗', e.message);
    process.exit(1);
  }

  // 2. Check events table
  const events = await get('/events?select=id,name,is_active,start_date,end_date&limit=5');
  console.log('2. events table:', events.ok ? '✓' : '✗', events.status);
  if (events.ok) {
    const arr = Array.isArray(events.data) ? events.data : [];
    console.log('   Rows:', arr.length, arr.length ? `- e.g. "${arr[0]?.name || ''}"` : '(run seed-event.sql if 0)');
  } else {
    console.log('   Error:', typeof events.data === 'string' ? events.data.slice(0, 120) : JSON.stringify(events.data).slice(0, 120));
  }

  // 3. Check schedule_sessions
  const sessions = await get('/schedule_sessions?select=id,title,start_time&limit=5');
  console.log('3. schedule_sessions:', sessions.ok ? '✓' : '✗', sessions.status);
  if (sessions.ok) {
    const arr = Array.isArray(sessions.data) ? sessions.data : [];
    console.log('   Rows:', arr.length, arr.length ? `- e.g. "${arr[0]?.title || ''}"` : '(run seed-schedule-4day.sql if 0)');
  }

  // 4. Check point_rules
  const rules = await get('/point_rules?select=id,action,points_value&limit=5');
  console.log('4. point_rules:', rules.ok ? '✓' : '✗', rules.status);
  if (rules.ok) {
    const arr = Array.isArray(rules.data) ? rules.data : [];
    console.log('   Rows:', arr.length);
  }

  // 5. Check users (might be RLS-blocked without auth)
  const users = await get('/users?select=id&limit=1');
  console.log('5. users table:', users.ok ? '✓' : '✗ (RLS may require auth)', users.status);

  // 6. announcements (push notifications)
  const announcements = await get('/announcements?select=id,event_id,title,sent_at&limit=5');
  console.log('6. announcements:', announcements.ok ? '✓' : '✗', announcements.status);
  if (announcements.ok && Array.isArray(announcements.data)) {
    console.log('   Rows:', announcements.data.length);
  }

  // 7. connections (Connect/Community)
  const connections = await get('/connections?select=id,event_id&limit=5');
  console.log('7. connections:', connections.ok ? '✓' : '✗', connections.status);
  if (connections.ok && Array.isArray(connections.data)) {
    console.log('   Rows:', connections.data.length);
  }

  // 8. connection_requests
  const connRequests = await get('/connection_requests?select=id,event_id,status&limit=5');
  console.log('8. connection_requests:', connRequests.ok ? '✓' : '✗', connRequests.status);
  if (connRequests.ok && Array.isArray(connRequests.data)) {
    console.log('   Rows:', connRequests.data.length);
  }

  // 9. event_members
  const eventMembers = await get('/event_members?select=id,event_id,user_id,role&limit=5');
  console.log('9. event_members:', eventMembers.ok ? '✓' : '✗', eventMembers.status);
  if (eventMembers.ok && Array.isArray(eventMembers.data)) {
    console.log('   Rows:', eventMembers.data.length);
  }

  // 10. posts (feed)
  const posts = await get('/posts?select=id,event_id,user_id&limit=5');
  console.log('10. posts:', posts.ok ? '✓' : '✗', posts.status);
  if (posts.ok && Array.isArray(posts.data)) {
    console.log('   Rows:', posts.data.length);
  }

  // 11. users.push_token exists (for push) — select only column
  const usersPush = await get('/users?select=push_token&limit=1');
  console.log('11. users.push_token (notifications):', usersPush.ok ? '✓' : '✗', usersPush.status);

  // 12–27. All other app tables (exist + anon can reach)
  const extra = [
    ['messages', 'id', '12. messages (DMs)'],
    ['notifications', 'id', '13. notifications'],
    ['likes', 'post_id', '14. likes'],
    ['comments', 'id', '15. comments'],
    ['user_schedule', 'user_id', '16. user_schedule (bookmarks)'],
    ['session_ratings', 'id', '17. session_ratings'],
    ['vendor_booths', 'id', '18. vendor_booths (B2B)'],
    ['meeting_slots', 'id', '19. meeting_slots'],
    ['meeting_bookings', 'id', '20. meeting_bookings'],
    ['chat_groups', 'id', '21. chat_groups'],
    ['chat_group_members', 'id', '22. chat_group_members'],
    ['group_messages', 'id', '23. group_messages'],
    ['blocked_users', 'blocker_id', '24. blocked_users'],
    ['user_reports', 'id', '25. user_reports'],
    ['point_log', 'id', '26. point_log'],
    ['session_reminder_sent', 'session_id', '27. session_reminder_sent (schedule push)'],
  ];
  const extraOk = [];
  for (const [table, col, label] of extra) {
    const r = await get(`/${table}?select=${col}&limit=1`);
    extraOk.push(r.ok);
    console.log(label + ':', r.ok ? '✓' : '✗', r.status);
  }

  const allOk =
    events.ok &&
    sessions.ok &&
    rules.ok &&
    users.ok &&
    announcements.ok &&
    connections.ok &&
    connRequests.ok &&
    eventMembers.ok &&
    posts.ok &&
    usersPush.ok &&
    extraOk.every(Boolean);

  console.log('\nDone. If any table is ✗, create it or run migrations (see supabase/migrations, SUPABASE-TABLES-CHECKLIST.md).');
  if (!allOk) {
    console.error('\nFAIL: One or more tables are missing or returned an error. Run migrations before iOS rebuild.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
