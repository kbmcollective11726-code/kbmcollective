#!/usr/bin/env node
/**
 * Run all project checks: TypeScript, Supabase (DB + notifications/connections), app config.
 * Usage: node scripts/run-all-tests.mjs
 */
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, shell: true, stdio: 'inherit', ...opts });
  return r.status === 0;
}

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log(' ' + title);
  console.log('='.repeat(60));
}

let failed = false;

// 1. TypeScript
section('1. TypeScript (tsc --noEmit)');
if (!run('npx', ['tsc', '--noEmit'])) {
  console.error('FAIL: TypeScript check failed.');
  failed = true;
} else {
  console.log('PASS: No TypeScript errors.');
}

// 2. App & notifications config
section('2. App config (EAS, notifications)');
try {
  const appJsonPath = resolve(root, 'app.json');
  const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  const expo = appJson.expo || {};
  const projectId = expo.extra?.eas?.projectId;
  const hasProjectId = !!projectId && projectId.length > 30;
  console.log('EAS projectId:', hasProjectId ? '✓ set' : '✗ missing or invalid');
  const plugins = expo.plugins || [];
  const hasNotifications = plugins.some((p) => (Array.isArray(p) ? p[0] === 'expo-notifications' : p === 'expo-notifications'));
  console.log('expo-notifications plugin:', hasNotifications ? '✓' : '✗');
  if (!hasProjectId || !hasNotifications) failed = true;
} catch (e) {
  console.error('FAIL: Could not read app.json:', e.message);
  failed = true;
}

// 3. Supabase (DB + tables for notifications, connections, etc.)
section('3. Supabase (API + tables)');
const supabaseOk = run('node', [resolve(__dirname, 'check-supabase.mjs')]);
if (!supabaseOk) {
  console.error('FAIL: Supabase check failed (see above).');
  failed = true;
}

section('Summary');
if (failed) {
  console.log('Some checks FAILED. Fix the issues above before pushing to TestFlight.');
  process.exit(1);
}
console.log('All checks PASSED. Notifications and systems look good.');
process.exit(0);
