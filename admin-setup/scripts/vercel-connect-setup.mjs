#!/usr/bin/env node
/**
 * Add connect.kbmcollective.org to admin-setup on Vercel + set VITE_PUBLIC_PORTAL_URL.
 * Requires Vercel CLI logged into KBMConnect's team:
 *   npx vercel login
 *   cd admin-setup && node scripts/vercel-connect-setup.mjs
 */
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../');
const SCOPE = 'kbmconnects-projects';
const PROJECT = 'admin-setup';
const DOMAIN = 'connect.kbmcollective.org';
const PORTAL_URL = 'https://connect.kbmcollective.org';

function run(cmd, input) {
  const r = spawnSync(cmd, {
    cwd: root,
    shell: true,
    input,
    stdio: input ? ['pipe', 'inherit', 'inherit'] : ['inherit', 'inherit', 'inherit'],
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log(`Linking to ${PROJECT} (${SCOPE})…`);
run(`npx vercel link --project ${PROJECT} --scope ${SCOPE} --yes`);

console.log(`Adding domain ${DOMAIN}…`);
run(`npx vercel domains add ${DOMAIN} ${PROJECT} --scope ${SCOPE}`);

console.log('Setting VITE_PUBLIC_PORTAL_URL for production + preview…');
for (const envType of ['production', 'preview']) {
  run(`npx vercel env add VITE_PUBLIC_PORTAL_URL ${envType} --scope ${SCOPE} --force`, PORTAL_URL);
}

console.log('\nDone. Redeploy production so the env var is baked in:');
console.log('  npx vercel --prod --scope kbmconnects-projects --yes');
console.log('\nVerify DNS: connect CNAME should point to cname.vercel-dns.com (check Vercel Domains UI).');
