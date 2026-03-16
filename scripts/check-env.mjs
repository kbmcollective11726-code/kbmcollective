#!/usr/bin/env node
/**
 * Validates .env for Supabase. Run from project root: node scripts/check-env.mjs
 * Does not print secrets; only checks format and that URL and anon key match.
 */
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env not found in project root.');
  process.exit(1);
}

const content = fs.readFileSync(envPath, 'utf8');
const vars = {};
for (const line of content.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  vars[key] = value;
}

const url = vars.EXPO_PUBLIC_SUPABASE_URL || vars.SUPABASE_URL || '';
const anonKey = vars.EXPO_PUBLIC_SUPABASE_ANON_KEY || vars.SUPABASE_ANON_KEY || '';
let ok = true;

if (!url) {
  console.error('❌ EXPO_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is missing in .env');
  ok = false;
} else if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
  console.error('❌ EXPO_PUBLIC_SUPABASE_URL should be https://YOUR_PROJECT_REF.supabase.co');
  ok = false;
} else if (url.endsWith('/')) {
  console.error('❌ EXPO_PUBLIC_SUPABASE_URL should not end with a slash');
  ok = false;
} else {
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  const projectRef = match ? match[1] : '';
  console.log('✓ EXPO_PUBLIC_SUPABASE_URL format OK (project ref: ' + projectRef + ')');
}

if (!anonKey) {
  console.error('❌ EXPO_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) is missing in .env');
  ok = false;
} else {
  const parts = anonKey.split('.');
  if (parts.length !== 3) {
    console.error('❌ EXPO_PUBLIC_SUPABASE_ANON_KEY should be a JWT (3 parts separated by dots)');
    ok = false;
  } else {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      const ref = payload.ref || payload.aud || '';
      const urlRef = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] || '';
      if (urlRef && ref && ref !== urlRef) {
        console.error('❌ Anon key project ref ("' + ref + '") does not match URL ref ("' + urlRef + '")');
        ok = false;
      } else {
        console.log('✓ EXPO_PUBLIC_SUPABASE_ANON_KEY format OK and matches URL project ref');
      }
    } catch (e) {
      console.error('❌ EXPO_PUBLIC_SUPABASE_ANON_KEY is not valid base64url JSON in payload:', e.message);
      ok = false;
    }
  }
}

if (ok) {
  console.log('\n✓ .env Supabase config is valid. Run "npx expo start --clear" so the app picks it up.');
} else {
  process.exit(1);
}
