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

  console.log('\nDone. If events/schedule_sessions have 0 rows, run seed scripts in Supabase SQL Editor.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
