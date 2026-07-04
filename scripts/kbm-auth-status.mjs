#!/usr/bin/env node
/**
 * Verify KBM CollectiveLive auth for CLI + document MCP status.
 * Run: node scripts/kbm-auth-status.mjs
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const SUPABASE_REF = 'noydhokbswedvltjyenr';
const VERCEL_TEAM = 'kbmconnects-projects';
const VERCEL_PROJECT = 'admin-setup';

function run(cmd, { cwd = root, allowFail = false } = {}) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

function section(title) {
  console.log(`\n## ${title}`);
}

function ok(msg) {
  console.log(`  OK   ${msg}`);
}

function fail(msg) {
  console.log(`  FAIL ${msg}`);
}

function warn(msg) {
  console.log(`  WARN ${msg}`);
}

async function testSupabaseToken(token) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_REF}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  console.log('KBM CollectiveLive — auth status');
  console.log(`Project: Supabase ${SUPABASE_REF} | Vercel ${VERCEL_TEAM}/${VERCEL_PROJECT}`);

  section('MCP (Cursor integrations)');
  ok('Supabase MCP configured in .cursor/mcp.json with project_ref=noydhokbswedvltjyenr');
  ok('Vercel MCP configured at https://mcp.vercel.com');
  warn('MCP uses Cursor OAuth — re-auth in Cursor Settings → MCP if tools fail');

  section('Supabase CLI');
  const projectsJson = run('npx supabase projects list --output json', { allowFail: true });
  if (!projectsJson) {
    fail('supabase projects list failed — run: npx supabase login');
  } else {
    try {
      const { projects } = JSON.parse(projectsJson);
      const linked = projects?.find((p) => p.ref === SUPABASE_REF);
      if (linked?.linked) ok(`Linked to CollectiveLive (${SUPABASE_REF})`);
      else if (linked) warn(`CollectiveLive visible but not linked — run: npx supabase link --project-ref ${SUPABASE_REF}`);
      else {
        fail(`CollectiveLive not in CLI account (wrong Supabase login)`);
        warn('Run: npx supabase logout && npx supabase login  (use kbmcollective org account)');
      }
    } catch {
      fail('Could not parse supabase projects list');
    }
  }

  const linkedFile = join(root, 'supabase', '.temp', 'linked-project.json');
  if (existsSync(linkedFile)) {
    const linked = JSON.parse(readFileSync(linkedFile, 'utf8'));
    if (linked.ref === SUPABASE_REF) ok(`Local link file points to ${linked.name}`);
    else warn(`Local link file points to ${linked.ref}, expected ${SUPABASE_REF}`);
  }

  if (process.env.SUPABASE_ACCESS_TOKEN) {
    const { status, body } = await testSupabaseToken(process.env.SUPABASE_ACCESS_TOKEN);
    if (status === 200) ok('SUPABASE_ACCESS_TOKEN has CollectiveLive access');
    else fail(`SUPABASE_ACCESS_TOKEN → ${status}: ${body.message ?? 'unauthorized'}`);
  } else {
    warn('No SUPABASE_ACCESS_TOKEN in env (optional PAT for scripts)');
  }

  section('Vercel CLI');
  const vercelUser = run('npx vercel whoami', { allowFail: true });
  if (vercelUser) console.log(`  User: ${vercelUser}`);
  else fail('vercel whoami failed — run: npx vercel login');

  const teamsJson = run('npx vercel teams ls --output json', { allowFail: true });
  if (teamsJson) {
    try {
      const teams = JSON.parse(teamsJson);
      const kbm = teams?.teams?.find((t) => t.slug === VERCEL_TEAM || t.name?.includes('KBM'));
      if (kbm) ok(`KBM team visible: ${kbm.name} (${kbm.slug})`);
      else {
        fail(`Team ${VERCEL_TEAM} not visible — wrong Vercel login`);
        warn('Run: npx vercel logout && npx vercel login  (use KBMConnect account)');
      }
    } catch {
      warn('Could not parse vercel teams (try: npx vercel teams ls)');
    }
  }

  const vercelProject = join(root, 'admin-setup', '.vercel', 'project.json');
  if (existsSync(vercelProject)) {
    const cfg = JSON.parse(readFileSync(vercelProject, 'utf8'));
    ok(`admin-setup/.vercel linked to project ${cfg.projectId}`);
  } else {
    warn(`Missing admin-setup/.vercel/project.json — run link from admin-setup/`);
  }

  if (process.env.VERCEL_TOKEN) {
    ok('VERCEL_TOKEN set in env');
  } else {
    warn('No VERCEL_TOKEN in env (optional — create at vercel.com/account/tokens for KBM team)');
  }

  section('Fix CLI (run in PowerShell)');
  console.log('  cd admin-setup');
  console.log('  npx vercel logout');
  console.log('  npx vercel login          # KBMConnect / kbmcollective account');
  console.log('  npx vercel link --project admin-setup --scope kbmconnects-projects --yes');
  console.log('');
  console.log('  cd ..');
  console.log('  npx supabase logout');
  console.log('  npx supabase login        # kbmcollective org account');
  console.log(`  npx supabase link --project-ref ${SUPABASE_REF}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
