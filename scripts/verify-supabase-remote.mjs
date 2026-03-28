#!/usr/bin/env node
/**
 * Read-only Supabase verification: extensions, tables, columns, avatars bucket, cron jobs.
 * Requires DATABASE_URL or SUPABASE_DB_URL in .env (Database → Connection string → URI).
 *
 * Usage: npm run supabase:verify
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

const Q_EXTENSIONS = `
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pg_cron', 'pg_net', 'supabase_vault', 'vault')
ORDER BY extname;
`;

const Q_TABLES = `
SELECT
  required.table_name AS "Table",
  CASE WHEN t.table_name IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS "Status"
FROM (
  SELECT unnest(ARRAY[
    'users', 'events', 'event_members', 'posts', 'likes', 'comments',
    'messages', 'notifications', 'announcements', 'schedule_sessions',
    'user_schedule', 'point_rules', 'point_log', 'connections',
    'connection_requests', 'blocked_users', 'user_reports',
    'chat_groups', 'chat_group_members', 'group_messages', 'chat_group_event',
    'session_reminder_sent', 'vendor_booths', 'meeting_slots', 'meeting_bookings',
    'session_ratings',
    'b2b_meeting_feedback', 'b2b_meeting_feedback_nudge_sent', 'b2b_meeting_reminder_sent'
  ]) AS table_name
) required
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = required.table_name
ORDER BY "Status" DESC, "Table";
`;

const Q_COLUMNS = `
WITH required AS (
  SELECT 'users' AS tname, unnest(ARRAY['id','email','full_name','push_token','is_platform_admin']) AS cname
  UNION ALL SELECT 'events', unnest(ARRAY['id','name','event_code','is_active'])
  UNION ALL SELECT 'event_members', unnest(ARRAY['event_id','user_id','role','roles','points'])
  UNION ALL SELECT 'posts', unnest(ARRAY['id','event_id','user_id','image_url','is_approved','is_deleted'])
  UNION ALL SELECT 'likes', unnest(ARRAY['post_id','user_id'])
  UNION ALL SELECT 'comments', unnest(ARRAY['id','post_id','user_id','content'])
  UNION ALL SELECT 'user_schedule', unnest(ARRAY['user_id','session_id'])
  UNION ALL SELECT 'point_log', unnest(ARRAY['id','user_id','event_id','action','points'])
  UNION ALL SELECT 'user_reports', unnest(ARRAY['id','reporter_id','reported_user_id'])
  UNION ALL SELECT 'messages', unnest(ARRAY['id','event_id','sender_id','receiver_id','content','attachment_url','attachment_type'])
  UNION ALL SELECT 'notifications', unnest(ARRAY['id','user_id','event_id','type','title','body','data','is_read'])
  UNION ALL SELECT 'chat_groups', unnest(ARRAY['id','event_id','name','created_by'])
  UNION ALL SELECT 'chat_group_members', unnest(ARRAY['id','group_id','user_id'])
  UNION ALL SELECT 'group_messages', unnest(ARRAY['id','group_id','sender_id','content','attachment_url','attachment_type'])
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
`;

const Q_BUCKET = `SELECT id, name, public FROM storage.buckets WHERE id = 'avatars';`;

const Q_CRON = `
SELECT jobid, jobname, schedule, active
FROM cron.job
ORDER BY jobname;
`;

function printRows(label, rows, keys) {
  console.log(`\n=== ${label} ===`);
  if (!rows.length) {
    console.log('  (no rows)');
    return;
  }
  for (const r of rows) {
    const line = keys.map((k) => `${k}=${JSON.stringify(r[k])}`).join('  ');
    console.log(' ', line);
  }
}

/** Parse URI without logging password — hints for common Supabase pooler mistakes */
function analyzeSupabaseDbUrl(conn) {
  try {
    const normalized = conn.trim().replace(/^postgresql:/i, 'http:').replace(/^postgres:/i, 'http:');
    const u = new URL(normalized);
    const user = decodeURIComponent(u.username || '');
    const host = u.hostname || '';
    const lines = [];
    if (host.includes('pooler.supabase.com')) {
      if (user === 'postgres' || !user.includes('.')) {
        lines.push(
          `Hint: Host is a Supabase pooler but username is "${user}". Use postgres.<project-ref> exactly as in Dashboard → Database → Connection string (URI).`
        );
      }
      if (u.port === '6543') {
        lines.push(
          'Note: Port 6543 = transaction pooler. If issues persist, copy the Session mode URI from the dashboard (often port 5432 on the pooler host).'
        );
      }
    }
    return lines.length ? lines.join('\n') : '';
  } catch {
    return '';
  }
}

function printPoolerTroubleshooting(databaseUrl) {
  console.error('\n---');
  console.error('Connection failed: "Tenant or user not found" (Supabase pooler / Supavisor).');
  console.error('Your DATABASE_URL is being rejected — usually username, password, or host does not match this project.\n');
  console.error('Do this:');
  console.error('  1. Supabase Dashboard → Project Settings → Database.');
  console.error('  2. Under "Connection string", pick URI and copy the FULL string (Session mode is best for ad-hoc SQL tools).');
  console.error('  3. User must be postgres.<PROJECT_REF> when connecting via *.pooler.supabase.com (not plain "postgres").');
  console.error('  4. Password = Database password from that page (use "Reset database password" if unsure). NOT the anon/service API key.');
  console.error('  5. If the password has @ # etc., the URI must URL-encode them, or paste from Dashboard which encodes for you.');
  console.error('  6. Still failing? Try the "Direct connection" URI from the same screen.\n');
  const hint = analyzeSupabaseDbUrl(databaseUrl);
  if (hint) console.error(hint + '\n');
  console.error('Docs: https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI');
  console.error('---\n');
}

loadEnv();
const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL or SUPABASE_DB_URL in .env');
  console.error('Supabase Dashboard → Project Settings → Database → Connection string (URI)');
  process.exit(1);
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const ext = await client.query(Q_EXTENSIONS);
    printRows('Extensions (pg_cron, pg_net, vault)', ext.rows, ['extname', 'extversion']);

    const tables = await client.query(Q_TABLES);
    const missingTables = tables.rows.filter((r) => r.Status === 'MISSING');
    printRows('Required public tables', tables.rows, ['Table', 'Status']);
    if (missingTables.length) {
      console.log(`\n  ⚠ Missing tables: ${missingTables.map((r) => r.Table).join(', ')}`);
    } else {
      console.log('\n  ✓ All required tables exist.');
    }

    const cols = await client.query(Q_COLUMNS);
    printRows('Missing critical columns (empty = OK)', cols.rows, ['Table', 'Missing column']);
    if (cols.rows.length) {
      console.log(`\n  ⚠ ${cols.rows.length} missing column(s) — fix schema or run migrations.`);
    } else {
      console.log('\n  ✓ No missing critical columns.');
    }

    const bucket = await client.query(Q_BUCKET);
    printRows("Storage bucket 'avatars'", bucket.rows, ['id', 'name', 'public']);
    if (!bucket.rows.length) {
      console.log('\n  ⚠ Create bucket "avatars" in Dashboard → Storage if uploads fail.');
    } else {
      console.log('\n  ✓ avatars bucket exists.');
    }

    try {
      const cron = await client.query(Q_CRON);
      printRows('pg_cron jobs', cron.rows, ['jobid', 'jobname', 'schedule', 'active']);
      const expected = [
        'process-scheduled-announcements',
        'notify-event-starting-soon',
        'notify-b2b-meeting-soon',
        'nudge-b2b-meeting-feedback',
        'auto-deactivate-events',
      ];
      const names = new Set(cron.rows.map((r) => r.jobname));
      const absent = expected.filter((n) => !names.has(n));
      if (absent.length) {
        console.log(`\n  ⚠ Expected cron job(s) missing: ${absent.join(', ')}`);
        console.log('     Run: npm run supabase:sql-notification-crons (needs Vault + CRON_SECRET).');
      } else {
        console.log('\n  ✓ All 5 standard notification/maintenance cron jobs present.');
      }
    } catch (e) {
      console.log('\n=== pg_cron jobs ===');
      console.log('  ⚠ Could not read cron.job:', e.message);
      console.log('     Enable extension pg_cron (Database → Extensions).');
    }

    console.log('\n--- Done (read-only). Edge functions & secrets: verify in Dashboard. ---\n');
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('Tenant or user not found')) {
      printPoolerTroubleshooting(databaseUrl);
    }
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  const msg = err?.message || String(err);
  if (!msg.includes('Tenant or user not found')) {
    console.error(msg);
  }
  process.exit(1);
});
