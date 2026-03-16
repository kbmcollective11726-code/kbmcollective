// Load .env so Supabase URL is available in Expo Go (bundle often doesn't get process.env).
// Must run from project root; run "npx expo start --clear" after changing .env.
const path = require('path');
const fs = require('fs');
const envPath = path.resolve(__dirname, '.env');
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';
let ANDROID_USE_R2 = '';
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    }
    if (!process.env[key]) process.env[key] = value;
    if (key === 'EXPO_PUBLIC_SUPABASE_URL') SUPABASE_URL = value;
    if (key === 'EXPO_PUBLIC_SUPABASE_ANON_KEY') SUPABASE_ANON_KEY = value;
    if (key === 'EXPO_PUBLIC_ANDROID_USE_R2') ANDROID_USE_R2 = value;
  });
}

function readEnv(key) {
  if (!fs.existsSync(envPath)) return '';
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    if (k !== key) continue;
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    }
    return v;
  }
  return '';
}

const appJson = require('./app.json');
// Embed Supabase in extra so Expo Go gets it via Constants.expoConfig.extra (reliable in dev).
module.exports = () => ({
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...(appJson.expo?.extra || {}),
      SUPABASE_URL: SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '',
      SUPABASE_ANON_KEY: SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
      ANDROID_USE_R2: ANDROID_USE_R2 || process.env.EXPO_PUBLIC_ANDROID_USE_R2 || readEnv('EXPO_PUBLIC_ANDROID_USE_R2') || '',
    },
  },
});
