#!/usr/bin/env node
/**
 * Push GitHub Actions secrets for admin-setup auto-deploy.
 * Reads Vercel CLI token from auth.json and VITE_* from repo .env.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ORG_ID = 'team_9FdwKI9UT4vqVAoQQYThQXhw';
const PROJECT_ID = 'prj_g2jmRQ7LKpEwTeSM62Mu1JNn1IJO';
const GITHUB_REPO = 'kbmcollective11726-code/kbmcollective';

function loadVercelToken() {
  const authPath =
    process.platform === 'win32'
      ? join(process.env.APPDATA ?? '', 'com.vercel.cli', 'Data', 'auth.json')
      : join(process.env.HOME ?? '', '.local', 'share', 'com.vercel.cli', 'auth.json');
  if (!existsSync(authPath)) throw new Error('Run `vercel login` first.');
  const auth = JSON.parse(readFileSync(authPath, 'utf8'));
  if (!auth.token?.trim()) throw new Error('No token in Vercel auth.json');
  return auth.token.trim();
}

function loadEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function ghSecretSet(name, value) {
  const r = spawnSync('gh', ['secret', 'set', name, '-R', GITHUB_REPO, '--body', value], {
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) throw new Error(`Failed to set secret ${name}`);
}

async function main() {
  const env = {
    ...loadEnvFile(join(repoRoot, '.env')),
    ...loadEnvFile(join(repoRoot, 'admin-setup', '.env')),
    ...loadEnvFile(join(repoRoot, 'admin-setup', '.env.vercel.production')),
    ...loadEnvFile(join(repoRoot, 'admin-setup', '.env.vercel.local')),
  };

  const secrets = {
    VERCEL_TOKEN: loadVercelToken(),
    VERCEL_ORG_ID: ORG_ID,
    VERCEL_PROJECT_ID: PROJECT_ID,
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL ?? '',
    VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY ?? '',
    VITE_PUBLIC_PORTAL_URL: env.VITE_PUBLIC_PORTAL_URL ?? 'https://connect.kbmcollective.org',
  };

  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !secrets[k]);
  if (missing.length) {
    throw new Error(`Missing in .env: ${missing.join(', ')}`);
  }

  console.log('Setting GitHub Actions secrets for auto-deploy…');
  for (const [name, value] of Object.entries(secrets)) {
    console.log(`  ${name}`);
    ghSecretSet(name, value);
  }
  console.log('\nDone. Push to master to trigger deploy via GitHub Actions.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
