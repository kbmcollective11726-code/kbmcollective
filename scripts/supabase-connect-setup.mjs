#!/usr/bin/env node
/**
 * Remote Supabase setup for connect.kbmcollective.org matchmaking.
 * Requires SUPABASE_ACCESS_TOKEN (Dashboard → Account → Access Tokens).
 *
 * Usage:
 *   set SUPABASE_ACCESS_TOKEN=sbp_...
 *   node scripts/supabase-connect-setup.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const PROJECT_REF = 'noydhokbswedvltjyenr';
const CONNECT_BASE = 'https://connect.kbmcollective.org';

const REDIRECTS_TO_ENSURE = [
  'https://cadmin.kbmcollective.org/auth-recovery.html',
  'https://cadmin.kbmcollective.org/portal/*/delegate/set-password',
  'https://connect.kbmcollective.org/portal/*/delegate/set-password',
  'https://connect.kbmcollective.org/portal/*/vendor/set-password',
  'collectivelive://reset-password',
];

const SECRETS_TO_ENSURE = [
  { name: 'PUBLIC_PORTAL_BASE_URL', value: CONNECT_BASE },
  { name: 'CONNECT_BASE_URL', value: CONNECT_BASE },
];

function loadEnv() {
  for (const rel of ['.env', join('admin-setup', '.env')]) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

function token() {
  const t = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!t) {
    console.error('Missing SUPABASE_ACCESS_TOKEN.');
    console.error('Create one at https://supabase.com/dashboard/account/tokens then re-run.');
    process.exit(1);
  }
  return t;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

function parseAllowList(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ensureAuthRedirects() {
  const cfg = await api(`/projects/${PROJECT_REF}/config/auth`);
  const current = parseAllowList(cfg.URI_ALLOW_LIST ?? cfg.uri_allow_list ?? '');
  const merged = [...new Set([...current, ...REDIRECTS_TO_ENSURE])];
  if (merged.length === current.length && REDIRECTS_TO_ENSURE.every((u) => current.includes(u))) {
    console.log('Auth redirect URLs already include connect + cadmin entries.');
    return;
  }
  await api(`/projects/${PROJECT_REF}/config/auth`, {
    method: 'PATCH',
    body: { URI_ALLOW_LIST: merged.join('\n') },
  });
  console.log(`Updated auth redirect URLs (${merged.length} total).`);
}

async function ensureSecrets() {
  const existing = await api(`/projects/${PROJECT_REF}/secrets`);
  const names = new Set((existing ?? []).map((s) => s.name));
  const toCreate = SECRETS_TO_ENSURE.filter((s) => !names.has(s.name));
  if (toCreate.length === 0) {
    console.log('Edge function secrets already set (PUBLIC_PORTAL_BASE_URL / CONNECT_BASE_URL).');
    return;
  }
  await api(`/projects/${PROJECT_REF}/secrets`, {
    method: 'POST',
    body: toCreate,
  });
  console.log(`Created secrets: ${toCreate.map((s) => s.name).join(', ')}`);
}

async function main() {
  loadEnv();
  console.log(`Supabase project: ${PROJECT_REF}`);
  await ensureAuthRedirects();
  await ensureSecrets();
  console.log('Done. Redeploy edge functions if secrets changed: npx supabase functions deploy send-registration-setup-email');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
