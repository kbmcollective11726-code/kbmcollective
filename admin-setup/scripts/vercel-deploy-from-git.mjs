#!/usr/bin/env node
/**
 * Trigger a Vercel production deployment from GitHub (no local upload).
 * Requires VERCEL_TOKEN with access to team_9FdwKI9UT4vqVAoQQYThQXhw.
 *
 * Usage:
 *   set VERCEL_TOKEN=...
 *   node scripts/vercel-deploy-from-git.mjs
 *   node scripts/vercel-deploy-from-git.mjs --ref master --sha 555a65c
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const TEAM_ID = 'team_9FdwKI9UT4vqVAoQQYThQXhw';
const PROJECT = 'admin-setup';
const GITHUB_ORG = 'kbmcollective11726-code';
const GITHUB_REPO = 'kbmcollective';
const DEFAULT_REF = 'master';

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

function parseArgs() {
  const args = process.argv.slice(2);
  let ref = DEFAULT_REF;
  let sha = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ref' && args[i + 1]) ref = args[++i];
    else if (args[i] === '--sha' && args[i + 1]) sha = args[++i];
  }
  return { ref, sha };
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
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 1000)}`);
  }
  return json;
}

async function main() {
  const { ref, sha } = parseArgs();
  console.log(`Deploying ${PROJECT} from ${GITHUB_ORG}/${GITHUB_REPO}@${ref}${sha ? ` (${sha})` : ''}…`);

  const body = {
    name: PROJECT,
    project: PROJECT,
    target: 'production',
    gitSource: {
      type: 'github',
      org: GITHUB_ORG,
      repo: GITHUB_REPO,
      ref,
      ...(sha ? { sha } : {}),
    },
  };

  const result = await api(`/v13/deployments?teamId=${TEAM_ID}`, { method: 'POST', body });
  console.log('Deployment created:');
  console.log(`  id: ${result.id}`);
  console.log(`  url: https://${result.url}`);
  console.log(`  inspector: https://vercel.com/kbmconnects-projects/${PROJECT}/${result.id}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
