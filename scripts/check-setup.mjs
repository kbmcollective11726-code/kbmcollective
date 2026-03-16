#!/usr/bin/env node
/**
 * Check if the app is set up correctly (Supabase, Cloudflare R2, Edge Function).
 * Run from project root: node scripts/check-setup.mjs
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function hasEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return { ok: false, msg: '.env not found' };
  const content = fs.readFileSync(envPath, 'utf8');
  const hasUrl = /EXPO_PUBLIC_SUPABASE_URL\s*=\s*\S+/.test(content) && !content.includes('YOUR_PROJECT');
  const hasKey = /EXPO_PUBLIC_SUPABASE_ANON_KEY\s*=\s*\S+/.test(content) && !content.includes('your_anon_key_here');
  if (!hasUrl) return { ok: false, msg: 'EXPO_PUBLIC_SUPABASE_URL missing or placeholder in .env' };
  if (!hasKey) return { ok: false, msg: 'EXPO_PUBLIC_SUPABASE_ANON_KEY missing or placeholder in .env' };
  return { ok: true, msg: 'Supabase URL and anon key set in .env' };
}

function hasEdgeFunction() {
  const fnPath = path.join(projectRoot, 'supabase', 'functions', 'get-r2-upload-url', 'index.ts');
  if (!fs.existsSync(fnPath)) return { ok: false, msg: 'get-r2-upload-url Edge Function not found' };
  return { ok: true, msg: 'get-r2-upload-url Edge Function present' };
}

function hasR2Config() {
  const fnPath = path.join(projectRoot, 'supabase', 'functions', 'get-r2-upload-url', 'index.ts');
  if (!fs.existsSync(fnPath)) return { ok: false, msg: 'Cannot check R2 config' };
  const content = fs.readFileSync(fnPath, 'utf8');
  const vars = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'];
  const missing = vars.filter((v) => !content.includes(v));
  if (missing.length) return { ok: false, msg: `Edge Function expects secrets: ${missing.join(', ')}` };
  return { ok: true, msg: 'Edge Function expects all 5 R2 secrets (set in Supabase Dashboard → Edge Functions → Secrets)' };
}

function supabaseSecrets() {
  try {
    const out = execSync('npx supabase secrets list', {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 15000,
    });
    const names = (out.match(/\S+/g) || []).filter((n) => n.startsWith('R2_'));
    const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'];
    const missing = required.filter((r) => !names.some((n) => n === r));
    if (missing.length) return { ok: false, msg: `Supabase secrets missing: ${missing.join(', ')}` };
    return { ok: true, msg: `All 5 R2 secrets set in Supabase (${names.length} R2_* found)` };
  } catch (e) {
    return { ok: false, msg: 'Run "npx supabase secrets list" (project must be linked and you logged in)' };
  }
}

function main() {
  console.log('\n--- CollectiveLive setup check ---\n');
  const checks = [
    { name: 'App .env (Supabase)', fn: hasEnv },
    { name: 'Edge Function (get-r2-upload-url)', fn: hasEdgeFunction },
    { name: 'R2 config in function', fn: hasR2Config },
    { name: 'Supabase R2 secrets', fn: supabaseSecrets },
  ];
  let allOk = true;
  for (const { name, fn } of checks) {
    const result = fn();
    const icon = result.ok ? '\u2713' : '\u2717';
    console.log(`${icon} ${name}: ${result.msg}`);
    if (!result.ok) allOk = false;
  }
  console.log('\n--- Manual checks (optional) ---');
  console.log('  Cloudflare R2: In Dashboard → R2, bucket "collectivelive-images" exists and has public access.');
  console.log('  Wrangler: Run "npx wrangler r2 bucket list" (after wrangler login) to list buckets.');
  console.log('  Post a photo in the app; image URL should be https://pub-xxxx.r2.dev/... if R2 is used.\n');
  process.exit(allOk ? 0 : 1);
}

main();
