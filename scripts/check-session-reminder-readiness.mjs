#!/usr/bin/env node
/**
 * Operational checklist for "Event starting soon" / B2B meeting reminders.
 * These are NOT sent from the phone — Supabase cron must call Edge Functions every ~2 min.
 *
 * Optional: set CRON_SECRET in .env (same as Edge Function + vault) to POST a test invoke.
 * Run: node scripts/check-session-reminder-readiness.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  const p = resolve(root, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

loadEnv();

const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const cronSecret = (process.env.CRON_SECRET ?? '').trim();

console.log(`
=== Session / B2B "starting soon" reminders ===

These require ALL of the following:

1) pg_cron jobs (Supabase → SQL):
   SELECT jobname, schedule FROM cron.job ORDER BY jobname;
   Expect: notify-event-starting-soon  (*/2 * * * *)
           notify-b2b-meeting-soon     (*/2 * * * *)
   If missing, run:
   - scripts/setup-session-reminder-5min.sql (table session_reminder_sent)
   - scripts/setup-event-starting-soon-cron.sql
   - scripts/setup-b2b-meeting-soon-cron.sql
   See: docs/FIX-PUSH-5MIN-NOT-RUNNING.md

2) Edge Function secrets (Dashboard → each function):
   CRON_SECRET must match vault cron_secret used in cron SQL.
   SUPABASE_SERVICE_ROLE_KEY set (project default).

3) Session timing: notify-event-starting-soon fires when session start is ~3–9 minutes
   from now in the event timezone (events.reminder_timezone or Edge secret SESSION_REMINDER_TIMEZONE).

4) User must be in event_members; session is_active; not already in session_reminder_sent.

5) Device push: users.push_token set (EAS/dev build, not Expo Go; notifications allowed).

6) In-app: notifications row inserted by the same function (works without push_token).

Project URL from .env: ${url ? url.replace(/https:\/\//, '') : '(missing EXPO_PUBLIC_SUPABASE_URL)'}
`);

if (!url || !cronSecret) {
  console.log('Optional test skipped: add CRON_SECRET to .env to POST a manual invoke.\n');
  process.exit(0);
}

const invoke = async (name) => {
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': cronSecret,
    },
    body: '{}',
  });
  const text = await res.text();
  console.log(`POST /functions/v1/${name} → ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text.slice(0, 800));
  }
};

console.log('Manual invoke (verify CRON_SECRET matches Edge Function):\n');
await invoke('notify-event-starting-soon');
console.log('');
await invoke('notify-b2b-meeting-soon');
console.log('');
