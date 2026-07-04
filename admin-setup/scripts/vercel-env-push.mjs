#!/usr/bin/env node
/**
 * Push Supabase + optional live wall URL from .env / eas.json to Vercel (production + preview).
 * Run from admin-setup: node scripts/vercel-env-push.mjs
 * Reads ../.env or .env; uses EXPO_PUBLIC_* or VITE_* or SUPABASE_* keys.
 * VITE_LIVE_WALL_URL: EXPO_PUBLIC_LIVE_WALL_URL or VITE_LIVE_WALL_URL from .env, else eas.json production env.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../');
const parent = resolve(root, '../');

function loadEnv(dir) {
  const path = resolve(dir, '.env');
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const env = { ...loadEnv(parent), ...loadEnv(root) };

function liveWallFromEas() {
  const p = resolve(parent, 'eas.json');
  if (!existsSync(p)) return '';
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const v = j?.build?.production?.env?.EXPO_PUBLIC_LIVE_WALL_URL;
    return typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

const url = env.VITE_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '';
const key = env.VITE_SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';
const liveWall =
  (env.EXPO_PUBLIC_LIVE_WALL_URL || env.VITE_LIVE_WALL_URL || '').trim().replace(/\/+$/, '') || liveWallFromEas();
const portalUrl =
  (env.VITE_PUBLIC_PORTAL_URL || env.PUBLIC_PORTAL_BASE_URL || 'https://connect.kbmcollective.org')
    .trim()
    .replace(/\/+$/, '');

if (!url || !key) {
  console.error('Missing Supabase vars. Add to .env (project root or admin-setup):');
  console.error('  EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co');
  console.error('  EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key');
  process.exit(1);
}

function addEnv(name, value, envType) {
  const r = spawnSync(`npx vercel env add ${name} ${envType} --force`, {
    cwd: root,
    shell: true,
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (r.status !== 0) {
    console.error(`Failed to set ${name} for ${envType}`);
    process.exit(1);
  }
}

for (const envType of ['production', 'preview']) {
  console.log(`Setting env for ${envType}...`);
  addEnv('VITE_SUPABASE_URL', url, envType);
  addEnv('VITE_SUPABASE_ANON_KEY', key, envType);
  if (liveWall) {
    console.log(`  VITE_LIVE_WALL_URL=${liveWall}`);
    addEnv('VITE_LIVE_WALL_URL', liveWall, envType);
  }
  console.log(`  VITE_PUBLIC_PORTAL_URL=${portalUrl}`);
  addEnv('VITE_PUBLIC_PORTAL_URL', portalUrl, envType);
}
if (!liveWall) {
  console.warn('Skip VITE_LIVE_WALL_URL (set EXPO_PUBLIC_LIVE_WALL_URL in .env or eas.json production).');
}
console.log('Done. Redeploy for changes: npx vercel --prod');
