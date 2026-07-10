#!/usr/bin/env node
/**
 * Deploy live-wall files to Vercel production via REST API (v13).
 * Requires VERCEL_TOKEN with access to team_9FdwKI9UT4vqVAoQQYThQXhw.
 *
 * Usage:
 *   set VERCEL_TOKEN=...
 *   node scripts/vercel-deploy-files-api.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEAM_ID = 'team_9FdwKI9UT4vqVAoQQYThQXhw';
const PROJECT = 'live-wall';

function loadToken() {
  if (process.env.VERCEL_TOKEN?.trim()) return process.env.VERCEL_TOKEN.trim();
  for (const rel of ['.env', join('..', '.env'), join('..', 'admin-setup', '.env')]) {
    const path = join(__dirname, '..', rel);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*VERCEL_TOKEN\s*=\s*(.*?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  console.error('Missing VERCEL_TOKEN');
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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : null;
}

async function pollDeployment(id) {
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    const d = await api(`/v13/deployments/${id}?teamId=${TEAM_ID}`);
    const state = d.readyState ?? d.state;
    process.stdout.write(`\rstate: ${state}   `);
    if (state === 'READY' || state === 'ERROR' || state === 'CANCELED') {
      console.log('');
      return d;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Timed out waiting for deployment');
}

async function main() {
  const payload = JSON.parse(readFileSync(join(__dirname, 'deploy-payload-slim.json'), 'utf8'));
  const files = payload.files;
  if (files.length !== 14) {
    console.error(`Expected 14 files, got ${files.length}`);
    process.exit(1);
  }
  console.log(`Deploying ${files.length} files to ${PROJECT} (production)…`);

  const body = {
    name: PROJECT,
    project: PROJECT,
    target: 'production',
    files: files.map(({ file, data }) => ({ file, data })),
    projectSettings: payload.projectSettings ?? { framework: 'nextjs' },
  };

  const created = await api(`/v13/deployments?teamId=${TEAM_ID}`, { method: 'POST', body });
  console.log(`Created: ${created.id}`);
  console.log(`URL: https://${created.url}`);

  const final = await pollDeployment(created.id);
  const state = final.readyState ?? final.state;
  console.log(JSON.stringify({ id: final.id, url: `https://${final.url}`, state }, null, 2));
  if (state === 'ERROR') process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
