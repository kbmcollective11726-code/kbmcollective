#!/usr/bin/env node
/**
 * Full health check: env, TypeScript, app config, Supabase, key files, and reminders.
 * Run: npm run check:health   or   node scripts/health-check.mjs
 * Then run the manual checklist in HEALTH-CHECK.md for complete testing.
 */
import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
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

function ok(msg) {
  console.log('  ✓', msg);
}
function fail(msg) {
  console.log('  ✗', msg);
}

let failed = false;

// 1. Environment
section('1. Environment (.env)');
const envPath = resolve(root, '.env');
if (!existsSync(envPath)) {
  fail('.env file missing');
  failed = true;
} else {
  const env = readFileSync(envPath, 'utf8');
  const hasUrl = /EXPO_PUBLIC_SUPABASE_URL\s*=\s*.+/.test(env) && !/placeholder/.test(env);
  const hasKey = /EXPO_PUBLIC_SUPABASE_ANON_KEY\s*=\s*.+/.test(env) && !/placeholder/.test(env);
  if (hasUrl) ok('EXPO_PUBLIC_SUPABASE_URL set'); else { fail('EXPO_PUBLIC_SUPABASE_URL missing or placeholder'); failed = true; }
  if (hasKey) ok('EXPO_PUBLIC_SUPABASE_ANON_KEY set'); else { fail('EXPO_PUBLIC_SUPABASE_ANON_KEY missing or placeholder'); failed = true; }
}

// 2. TypeScript
section('2. TypeScript (tsc --noEmit)');
if (!run('npx', ['tsc', '--noEmit'])) {
  fail('TypeScript check failed.');
  failed = true;
} else {
  ok('No TypeScript errors.');
}

// 3. App config (EAS, notifications)
section('3. App config (EAS, notifications)');
try {
  const appJsonPath = resolve(root, 'app.json');
  const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  const expo = appJson.expo || {};
  const projectId = expo.extra?.eas?.projectId;
  const hasProjectId = !!projectId && projectId.length > 30;
  if (hasProjectId) ok('EAS projectId set'); else { fail('EAS projectId missing or invalid'); failed = true; }
  const plugins = expo.plugins || [];
  const hasNotifications = plugins.some((p) => (Array.isArray(p) ? p[0] === 'expo-notifications' : p === 'expo-notifications'));
  if (hasNotifications) ok('expo-notifications plugin'); else { fail('expo-notifications plugin missing'); failed = true; }
} catch (e) {
  fail('Could not read app.json: ' + e.message);
  failed = true;
}

// 4. Supabase (API connectivity)
section('4. Supabase (API + auth)');
const supabaseOk = run('node', [resolve(__dirname, 'check-supabase.mjs')]);
if (!supabaseOk) {
  fail('Supabase check failed (see above).');
  failed = true;
} else {
  ok('Supabase API and tables OK.');
}

// 5. Key app files (routes + libs)
section('5. Key files (routes & libs)');
const requiredFiles = [
  'app/index.tsx',
  'app/_layout.tsx',
  'app/(auth)/login.tsx',
  'app/(auth)/register.tsx',
  'app/(tabs)/_layout.tsx',
  'app/(tabs)/home.tsx',
  'app/(tabs)/feed/index.tsx',
  'app/(tabs)/schedule.tsx',
  'app/(tabs)/expo/index.tsx',
  'app/(tabs)/expo/[boothId].tsx',
  'app/(tabs)/community.tsx',
  'app/(tabs)/leaderboard.tsx',
  'app/(tabs)/profile/index.tsx',
  'app/(tabs)/profile/admin.tsx',
  'app/(tabs)/profile/admin-vendor-booths.tsx',
  'app/(tabs)/profile/admin-vendor-booth-edit.tsx',
  'app/(tabs)/profile/admin-schedule.tsx',
  'app/(tabs)/profile/notifications.tsx',
  'lib/supabase.ts',
  'lib/notifications.ts',
  'lib/pushNotifications.ts',
  'lib/meetingReminders.ts',
  'lib/useDeepLink.ts',
  'stores/authStore.ts',
  'stores/eventStore.ts',
];
let missing = 0;
for (const f of requiredFiles) {
  if (!existsSync(resolve(root, f))) {
    fail('Missing: ' + f);
    missing++;
  }
}
if (missing === 0) ok(requiredFiles.length + ' key files present.');
else failed = true;

// 6. R2 (Cloudflare) — Edge Functions + optional live check
section('6. R2 (Cloudflare)');
const r2FnPath = resolve(root, 'supabase', 'functions', 'get-r2-upload-url', 'index.ts');
const r2ProxyPath = resolve(root, 'supabase', 'functions', 'upload-image-to-r2', 'index.ts');
if (!existsSync(r2FnPath)) {
  fail('get-r2-upload-url Edge Function not found');
  failed = true;
} else {
  ok('get-r2-upload-url Edge Function present');
}
if (!existsSync(r2ProxyPath)) {
  fail('upload-image-to-r2 Edge Function not found (Android proxy)');
  failed = true;
} else {
  ok('upload-image-to-r2 Edge Function present');
}
// Live check: call function with anon as Bearer → 401 = deployed; 503 = R2 not configured
function runR2LiveCheck(done) {
  if (!existsSync(envPath)) return done();
  try {
    const envContent = readFileSync(envPath, 'utf8');
    const urlMatch = envContent.match(/EXPO_PUBLIC_SUPABASE_URL\s*=\s*(\S+)/);
    const keyMatch = envContent.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY\s*=\s*(\S+)/);
    const supabaseUrl = urlMatch?.[1]?.trim?.();
    const anonKey = keyMatch?.[1]?.trim?.();
    if (!supabaseUrl || !anonKey || supabaseUrl.includes('YOUR_') || anonKey.includes('your_anon')) {
      console.log('  Skip R2 live check: .env URL/key missing or placeholder.');
      return done();
    }
    const fnUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/get-r2-upload-url`;
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 15000);
    fetch(fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
      body: JSON.stringify({ key: 'health-check-test', contentType: 'image/jpeg' }),
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(to);
        const status = res.status;
        if (status === 401) ok('R2 Edge Function deployed (auth required; R2 secrets not verified here).');
        else if (status === 503) {
          fail('R2 Edge Function says "R2 not configured". Set all 5 secrets in Supabase → Edge Functions → Secrets (see R2-SETUP.md).');
          failed = true;
        } else if (status === 200) ok('R2 Edge Function OK (returned upload URL).');
        else console.log('  R2 function returned', status, await res.text().catch(() => ''));
      })
      .catch((e) => {
        clearTimeout(to);
        console.log('  R2 live check skip:', e?.message || String(e));
      })
      .finally(done);
  } catch (e) {
    console.log('  R2 live check skip:', e?.message || String(e));
    done();
  }
}

runR2LiveCheck(() => {
  // 7. Optional: Supabase tables (needs DATABASE_URL)
  section('7. Supabase tables (optional, needs DATABASE_URL)');
  if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL) {
    const tablesOk = run('node', [resolve(__dirname, 'check-supabase-tables.mjs')]);
    if (!tablesOk) console.log('  (Tables check failed; see above. Ensure migrations are applied.)');
    else ok('Required tables present.');
  } else {
    console.log('  Skip: DATABASE_URL not set. Run with DATABASE_URL in .env to verify tables.');
  }

  // Summary + manual checklist reminder
  section('Summary');
  if (failed) {
    console.log('Some automated checks FAILED. Fix the issues above.');
    console.log('\nThen run the full manual checklist: HEALTH-CHECK.md');
    process.exit(1);
  }
  console.log('All automated checks PASSED.');
  console.log('\n--- Next step: manual testing ---');
  console.log('Open HEALTH-CHECK.md and run through every section to test the full app.');
  console.log('  (Auth, every tab, every button/link, notifications, B2B, admin flows.)');
  process.exit(0);
});
