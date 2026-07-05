#!/usr/bin/env node
/**
 * Production deploy for admin-setup (connect + cadmin).
 *
 * - Clears stale VERCEL_TOKEN env (invalid token breaks `vercel login` session).
 * - Runs from repo root because Vercel project rootDirectory is `admin-setup`.
 */
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const env = { ...process.env };
delete env.VERCEL_TOKEN;

const args = ['vercel', '--prod', '--scope', 'kbmconnects-projects', '--yes'];
const result = spawnSync('npx', args, { stdio: 'inherit', env, cwd: repoRoot, shell: true });
process.exit(result.status ?? 1);
