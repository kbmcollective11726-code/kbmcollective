#!/usr/bin/env node
/**
 * Production deploy for live-wall on kbmconnects-projects.
 *
 * - Clears stale VERCEL_TOKEN env (invalid token breaks `vercel login` session).
 * - Uses VERCEL_ORG_ID / VERCEL_PROJECT_ID (CLI v50 has no --project flag).
 *
 * Prerequisite: `vercel login` as kbmcollective11726-code (KBMConnect team).
 */
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const liveWallRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  VERCEL_ORG_ID: 'team_9FdwKI9UT4vqVAoQQYThQXhw',
  VERCEL_PROJECT_ID: 'prj_JfQzkGjUqdC9wWqWvLGiAikCtgAU',
};
delete env.VERCEL_TOKEN;

const args = ['vercel', '--prod', '--scope', 'kbmconnects-projects', '--yes'];
const result = spawnSync('npx', args, { stdio: 'inherit', env, cwd: liveWallRoot, shell: true });
process.exit(result.status ?? 1);
