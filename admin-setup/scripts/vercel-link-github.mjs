#!/usr/bin/env node
/**
 * Connect kbmcollective GitHub repo to admin-setup on Vercel + set Root Directory.
 *
 * Requires VERCEL_TOKEN for KBMConnect team (Dashboard → Account → Tokens).
 *
 * Usage:
 *   set VERCEL_TOKEN=...
 *   node scripts/vercel-link-github.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const TEAM_ID = 'team_9FdwKI9UT4vqVAoQQYThQXhw';
const PROJECT = 'admin-setup';
const GITHUB_REPO = 'kbmcollective11726-code/kbmcollective';
const ROOT_DIRECTORY = 'admin-setup';
const PRODUCTION_BRANCH = 'master';

function loadToken() {
  if (process.env.VERCEL_TOKEN?.trim()) return process.env.VERCEL_TOKEN.trim();
  for (const rel of ['.env', join('..', '.env')]) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*VERCEL_TOKEN\s*=\s*(.*?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  console.error('Missing VERCEL_TOKEN. Create one at https://vercel.com/account/tokens');
  process.exit(1);
}

async function api(path, { method = 'GET', body } = {}) {
  const token = loadToken();
  const res = await fetch(`https://api.vercel.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 800)}`);
  }
  return json;
}

async function main() {
  console.log(`Team: KBMConnect (${TEAM_ID})`);
  console.log(`Project: ${PROJECT}`);
  console.log(`GitHub: ${GITHUB_REPO}`);
  console.log(`Root directory: ${ROOT_DIRECTORY}`);

  const project = await api(`/v9/projects/${PROJECT}?teamId=${TEAM_ID}`);
  const linked = project.link?.type === 'github' ? project.link.repo : null;
  if (linked === GITHUB_REPO) {
    console.log('GitHub repo already linked.');
  } else {
    console.log(linked ? `Replacing link ${linked}…` : 'Linking GitHub repo…');
    await api(`/v9/projects/${PROJECT}/link?teamId=${TEAM_ID}`, {
      method: 'POST',
      body: { type: 'github', repo: GITHUB_REPO },
    });
    console.log('GitHub linked.');
  }

  if (project.rootDirectory !== ROOT_DIRECTORY) {
    console.log(`Setting rootDirectory → ${ROOT_DIRECTORY}…`);
    await api(`/v9/projects/${PROJECT}?teamId=${TEAM_ID}`, {
      method: 'PATCH',
      body: { rootDirectory: ROOT_DIRECTORY },
    });
    console.log('Root directory updated.');
  } else {
    console.log('Root directory already admin-setup.');
  }

  console.log(`Production branch: ${PRODUCTION_BRANCH} (set in Vercel → Settings → Git if needed).`);
  console.log('\nDone. Push to master on GitHub to trigger a production deploy.');
  console.log('Or redeploy: npx vercel --prod --scope kbmconnects-projects');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
