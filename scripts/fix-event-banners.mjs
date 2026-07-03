/**
 * One-off: letterbox all event banners to 1200×750 via normalize-event-banner edge function.
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env (or env var).
 *
 * Usage: node scripts/fix-event-banners.mjs [event_id ...]
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  for (const name of ['.env', 'admin-setup/.env']) {
    const p = resolve(root, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

loadEnv();

const url =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Need SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const eventIds = process.argv.slice(2);
const fnUrl = `${url.replace(/\/$/, '')}/functions/v1/normalize-event-banner`;

async function listEventsWithBanners() {
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/events?select=id,name,banner_url&banner_url=not.is.null`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!res.ok) throw new Error(`List events failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function normalize(eventId) {
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ event_id: eventId }),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(body.error || text.slice(0, 200) || `HTTP ${res.status}`);
  return body;
}

const targets =
  eventIds.length > 0
    ? eventIds.map((id) => ({ id, name: id }))
    : await listEventsWithBanners();

for (const ev of targets) {
  const id = ev.id ?? ev;
  const label = ev.name ?? id;
  try {
    const out = await normalize(id);
    console.log(`OK ${label}: ${out.banner_url} (${out.width}×${out.height})`);
  } catch (err) {
    console.error(`FAIL ${label}:`, err instanceof Error ? err.message : err);
  }
}
