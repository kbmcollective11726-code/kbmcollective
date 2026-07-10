#!/usr/bin/env node
/**
 * Deploy live-wall to kbmconnects-projects from GitHub using VERCEL_OIDC_TOKEN.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const TEAM_ID = 'team_9FdwKI9UT4vqVAoQQYThQXhw';
const PROJECT = 'live-wall';

function loadOidcToken() {
  const paths = [
    join(root, '..', 'admin-setup', '.env.vercel.local'),
    join(root, '..', 'admin-setup', '.env.vercel.production'),
  ];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.includes('VERCEL_OIDC_TOKEN')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      return line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  throw new Error('Missing VERCEL_OIDC_TOKEN in admin-setup/.env.vercel.*');
}

function parseArgs() {
  const args = process.argv.slice(2);
  let ref = 'master';
  let sha = '6eceb19';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ref' && args[i + 1]) ref = args[++i];
    else if (args[i] === '--sha' && args[i + 1]) sha = args[++i];
  }
  return { ref, sha };
}

async function main() {
  const { ref, sha } = parseArgs();
  const token = loadOidcToken();
  console.log(`Deploying ${PROJECT} on kbmconnects-projects from ${ref}@${sha}…`);

  const body = {
    name: PROJECT,
    project: PROJECT,
    target: 'production',
    gitSource: {
      type: 'github',
      org: 'kbmcollective11726-code',
      repo: 'kbmcollective',
      ref,
      sha,
    },
  };

  const res = await fetch(`https://api.vercel.com/v13/deployments?teamId=${TEAM_ID}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`API ${res.status}:`, text.slice(0, 2000));
    process.exit(1);
  }

  const result = JSON.parse(text);
  console.log('Deployment created:');
  console.log(`  id: ${result.id}`);
  console.log(`  url: https://${result.url}`);
  console.log(`  inspector: https://vercel.com/kbmconnects-projects/${PROJECT}/${result.id}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
