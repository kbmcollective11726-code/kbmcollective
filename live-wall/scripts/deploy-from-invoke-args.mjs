#!/usr/bin/env node
/**
 * Deploy live-wall from .mcp-invoke-args.json via Vercel API (same payload as deploy_to_vercel MCP).
 * Polls until READY or ERROR. Writes result to .deploy-result.json
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const TEAM_ID = 'team_9FdwKI9UT4vqVAoQQYThQXhw';
const PROJECT_ID = 'prj_JfQzkGjUqdC9wWqWvLGiAikCtgAU';
const ARGS_PATH = join(__dirname, '.mcp-invoke-args.json');
const RESULT_PATH = join(__dirname, '.deploy-result.json');

function loadToken() {
  if (process.env.VERCEL_TOKEN?.trim()) return process.env.VERCEL_TOKEN.trim();
  for (const rel of ['.env', join('..', '.env'), join('..', 'admin-setup', '.env')]) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*VERCEL_TOKEN\s*=\s*(.*?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  throw new Error('Missing VERCEL_TOKEN');
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = JSON.parse(readFileSync(ARGS_PATH, 'utf8'));
  if (!args.files || args.files.length !== 14) {
    throw new Error(`Expected 14 files, got ${args.files?.length ?? 0}`);
  }

  const body = {
    name: args.name,
    project: args.name,
    target: args.target,
    files: args.files.map((f) => ({ file: f.file, data: f.data })),
    projectSettings: args.projectSettings,
  };

  console.log(`Deploying ${args.name} (${args.files.length} files) to ${args.target}…`);
  const created = await api(`/v13/deployments?teamId=${TEAM_ID}`, { method: 'POST', body });
  const deploymentId = created.id;
  const url = created.url ? `https://${created.url}` : null;
  console.log('Created:', deploymentId, url);

  const start = Date.now();
  const maxMs = 10 * 60 * 1000;
  let finalState = 'UNKNOWN';
  let deployment = null;

  while (Date.now() - start < maxMs) {
    await sleep(7000);
    const list = await api(`/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&limit=5`);
    deployment = (list.deployments ?? []).find((d) => d.uid === deploymentId || d.id === deploymentId);
    if (!deployment) {
      const single = await api(`/v13/deployments/${deploymentId}?teamId=${TEAM_ID}`);
      deployment = single;
    }
    const state = (deployment?.readyState ?? deployment?.state ?? '').toUpperCase();
    console.log('Poll:', state);
    if (state === 'READY' || state === 'ERROR' || state === 'CANCELED') {
      finalState = state;
      break;
    }
  }

  const result = {
    deploymentId,
    url: deployment?.url ? `https://${deployment.url}` : url,
    alias: deployment?.alias?.[0] ?? null,
    finalState,
    buildErrors: null,
  };

  if (finalState === 'ERROR') {
    try {
      const logs = await api(
        `/v2/deployments/${deploymentId}/events?teamId=${TEAM_ID}&direction=backward&limit=100`
      );
      const errors = (logs ?? [])
        .filter((e) => /error|stderr|fail/i.test(e.type ?? '') || /error/i.test(e.text ?? e.payload?.text ?? ''))
        .map((e) => e.text ?? e.payload?.text ?? JSON.stringify(e))
        .filter(Boolean);
      result.buildErrors = errors.length ? errors : ['Build failed — see Vercel inspector for details'];
    } catch (err) {
      result.buildErrors = [String(err.message || err)];
    }
  }

  writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
