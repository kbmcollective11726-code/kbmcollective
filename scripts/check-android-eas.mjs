#!/usr/bin/env node
/**
 * Health check for EAS Android builds (APK + AAB), not local Gradle.
 * Validates eas.json profiles, app config, Firebase package match, and env parity.
 * Run: npm run check:android-eas
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let failed = false;

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log(' ' + title);
  console.log('='.repeat(60));
}

function ok(msg) {
  console.log('  ✓', msg);
}
function warn(msg) {
  console.log('  ⚠', msg);
}
function fail(msg) {
  console.log('  ✗', msg);
  failed = true;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`${label}: ${e.message}`);
    return null;
  }
}

section('1. eas.json (APK + AAB profiles)');
const easPath = resolve(root, 'eas.json');
if (!existsSync(easPath)) {
  fail('eas.json missing');
} else {
  const eas = readJson(easPath, 'eas.json');
  if (eas) {
    const preview = eas.build?.preview;
    const prod = eas.build?.production;
    const dev = eas.build?.development;
    if (preview?.android?.buildType === 'apk') ok('preview → android.buildType: apk (internal APK)');
    else fail('preview profile must set android.buildType to "apk"');
    if (prod?.android?.buildType === 'app-bundle') ok('production → android.buildType: app-bundle (Play AAB)');
    else fail('production profile must set android.buildType to "app-bundle"');
    if (dev?.android?.buildType === 'apk') ok('development → android.buildType: apk (dev client)');
    else warn('development profile: expected android.buildType apk for dev client builds');

    const requiredEnv = [
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'EXPO_PUBLIC_PASSWORD_RESET_WEB_URL',
      'EXPO_PUBLIC_LIVE_WALL_URL',
    ];
    for (const key of requiredEnv) {
      if (preview?.env?.[key] && prod?.env?.[key]) ok(`EAS env "${key}" on preview + production`);
      else fail(`Set "${key}" in eas.json → build.preview.env and build.production.env (EAS injects at build time)`);
    }
  }
}

section('2. app.json (EAS project + Android identity)');
const appJsonPath = resolve(root, 'app.json');
const appJson = readJson(appJsonPath, 'app.json');
if (appJson) {
  const expo = appJson.expo || {};
  const pid = expo.extra?.eas?.projectId;
  if (pid && String(pid).length > 30) ok(`EAS projectId: ${pid.slice(0, 8)}…`);
  else fail('expo.extra.eas.projectId missing or invalid');
  const pkg = expo.android?.package;
  if (pkg) ok(`android.package: ${pkg}`);
  else fail('expo.android.package missing');
  const vc = expo.android?.versionCode;
  const ver = expo.version;
  if (vc != null && ver) ok(`version ${ver}, android.versionCode ${vc}`);
  else fail('expo.version and/or expo.android.versionCode missing');
  const gsf = expo.android?.googleServicesFile;
  if (gsf) ok(`googleServicesFile: ${gsf}`);
  else fail('expo.android.googleServicesFile missing');
}

section('3. google-services.json (package name vs app)');
const gPath = resolve(root, 'google-services.json');
if (!existsSync(gPath)) {
  fail('google-services.json missing at repo root (required for Firebase / FCM)');
} else {
  const g = readJson(gPath, 'google-services.json');
  const expectedPkg = appJson?.expo?.android?.package;
  const clients = g?.client;
  const pkgFromG =
    Array.isArray(clients) && clients[0]?.client_info?.android_client_info?.package_name;
  if (pkgFromG && expectedPkg && pkgFromG === expectedPkg) {
    ok(`package_name matches app.json (${pkgFromG})`);
  } else {
    fail(
      `Firebase package_name mismatch or missing: google-services has "${pkgFromG}", app.json has "${expectedPkg}"`
    );
  }
}

section('4. Native android/ version vs app.json');
const gradlePath = resolve(root, 'android', 'app', 'build.gradle');
if (existsSync(gradlePath)) {
  const gradle = readFileSync(gradlePath, 'utf8');
  const vcMatch = gradle.match(/versionCode\s+(\d+)/);
  const vnMatch = gradle.match(/versionName\s+"([^"]+)"/);
  const appVc = appJson?.expo?.android?.versionCode;
  const appVer = appJson?.expo?.version;
  if (vcMatch && appVc != null && Number(vcMatch[1]) === Number(appVc)) {
    ok(`android/app/build.gradle versionCode ${vcMatch[1]} matches app.json`);
  } else {
    fail(
      `android/app/build.gradle versionCode (${vcMatch?.[1] ?? '?'}) should match app.json android.versionCode (${appVc})`
    );
  }
  if (vnMatch && appVer && vnMatch[1] === appVer) {
    ok(`android/app/build.gradle versionName "${vnMatch[1]}" matches app.json`);
  } else {
    fail(
      `android/app/build.gradle versionName (${vnMatch?.[1] ?? '?'}) should match expo.version (${appVer})`
    );
  }
} else {
  warn('android/app/build.gradle not found (bare workflow / prebuild will generate)');
}

section('5. Resolved Expo config (app.config.js + app.json)');
let configStdout = '';
try {
  configStdout = execSync('npx expo config --json --type public', {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (e) {
  fail(`expo config failed: ${e.stderr || e.message || String(e)}`);
  configStdout = '';
}
if (configStdout) {
  try {
    const cfg = JSON.parse(configStdout);
    // `expo config --json` returns a flat manifest (android at top level), not { expo: {} }.
    const android = cfg.expo?.android ?? cfg.android;
    if (android?.package) ok(`Resolved android.package: ${android.package}`);
    else fail('Resolved config missing android.package');
    if (android?.googleServicesFile) ok(`Resolved googleServicesFile: ${android.googleServicesFile}`);
    else fail('Resolved config missing android.googleServicesFile');
  } catch (e) {
    fail(`Could not parse expo config JSON: ${e.message}`);
  }
}

section('6. expo-doctor (project-wide)');
const doc = spawnSync('npx', ['expo-doctor'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 5 * 1024 * 1024,
});
const docOut = `${doc.stdout || ''}${doc.stderr || ''}`;
if (doc.status === 0) {
  ok('expo-doctor passed');
} else {
  warn('expo-doctor reported issues (non-fatal for EAS cloud build)');
  if (docOut.trim()) console.log(docOut.slice(-3500));
}

section('Summary');
if (failed) {
  console.log('\nAndroid EAS health check FAILED. Fix the items marked ✗ above.');
  process.exitCode = 1;
} else {
  console.log('\nAndroid EAS setup looks consistent for cloud builds.');
  console.log('  APK:  eas build --platform android --profile preview');
  console.log('  AAB:  eas build --platform android --profile production');
  process.exitCode = 0;
}
