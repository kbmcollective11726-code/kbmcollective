#!/usr/bin/env node
/**
 * Verify Supabase connection and key setup.
 * Loads .env from project root. Run: node scripts/verify-supabase-setup.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  const path = resolve(root, '.env');
  if (!existsSync(path)) {
    console.warn('No .env file found. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
    return {};
  }
  const text = readFileSync(path, 'utf8');
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const env = loadEnv();
const url = env.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, anonKey);

const tables = [
  'users',
  'events',
  'event_members',
  'schedule_sessions',
  'posts',
  'announcements',
  'notifications',
  'session_reminder_sent',
];

async function checkTable(name) {
  try {
    const { error } = await supabase.from(name).select('*').limit(0);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  console.log('Supabase URL:', url.replace(/\/$/, '').slice(0, 50) + '...');
  console.log('Checking tables (anon key, RLS applies):\n');

  let allOk = true;
  for (const table of tables) {
    const r = await checkTable(table);
    const status = r.ok ? 'OK' : 'FAIL';
    if (!r.ok) allOk = false;
    console.log(`  ${table.padEnd(24)} ${status}${r.error ? ' — ' + r.error : ''}`);
  }

  // Optional: count users (if RLS allows)
  const { count: userCount, error: userErr } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  if (!userErr) {
    console.log('\n  users row count (anon):', userCount ?? '—');
  }

  const { count: eventCount, error: eventErr } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true });
  if (!eventErr) {
    console.log('  events row count (anon):', eventCount ?? '—');
  }

  if (!allOk) {
    console.log('\nIf session_reminder_sent is FAIL: run scripts/setup-session-reminder-5min.sql in Supabase SQL Editor.');
    console.log('If other tables FAIL: run supabase-schema.sql or the relevant migration scripts.');
  } else {
    console.log('\nAll listed tables are present and reachable.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
