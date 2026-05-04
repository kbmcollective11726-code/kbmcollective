#!/usr/bin/env node
/**
 * Set VITE_LIVE_WALL_URL on Vercel (production + preview) from eas.json production EXPO_PUBLIC_LIVE_WALL_URL.
 * Run from admin-setup: node scripts/vercel-live-wall-push.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../');
const parent = resolve(root, '../');

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

const live = liveWallFromEas();
if (!live) {
  console.error('No EXPO_PUBLIC_LIVE_WALL_URL in eas.json → build.production.env');
  process.exit(1);
}

function addEnv(envType) {
  const r = spawnSync(`npx vercel env add VITE_LIVE_WALL_URL ${envType} --force`, {
    cwd: root,
    shell: true,
    input: live,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf-8',
  });
  if (r.status !== 0) {
    console.error(`Failed VITE_LIVE_WALL_URL for ${envType} (exit ${r.status})`);
    process.exit(1);
  }
}

for (const envType of ['production', 'preview']) {
  console.log(`Setting VITE_LIVE_WALL_URL for ${envType} = ${live}`);
  addEnv(envType);
}
console.log('Done. Redeploy admin: npx vercel deploy --prod --yes');
