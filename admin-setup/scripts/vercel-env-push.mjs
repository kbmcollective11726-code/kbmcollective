#!/usr/bin/env node
/**
 * Push Supabase env vars from .env to Vercel (production + preview).
 * Run from admin-setup: node scripts/vercel-env-push.mjs
 * Reads ../.env or .env; uses EXPO_PUBLIC_* or VITE_* or SUPABASE_* keys.
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
const url = env.VITE_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '';
const key = env.VITE_SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';

if (!url || !key) {
  console.error('Missing Supabase vars. Add to .env (project root or admin-setup):');
  console.error('  EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co');
  console.error('  EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key');
  process.exit(1);
}

function addEnv(name, value, envType) {
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vercel', 'env', 'add', name, envType, '--force'], {
    cwd: root,
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
}
console.log('Done. Redeploy for changes: npx vercel --prod');
