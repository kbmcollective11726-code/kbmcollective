#!/usr/bin/env node
/** Preview deploy — same as prod script but without --prod. */
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const env = { ...process.env };
delete env.VERCEL_TOKEN;

const result = spawnSync('npx', ['vercel', '--scope', 'kbmconnects-projects', '--yes'], {
  stdio: 'inherit',
  env,
  cwd: repoRoot,
  shell: true,
});
process.exit(result.status ?? 1);
