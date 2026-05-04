/**
 * Work around Expo CLI + Node undici: dependency validation can throw
 * "TypeError: Body is unusable: Body has already been read" on some setups.
 * @see https://github.com/expo/expo/issues (fetch response consumed twice)
 *
 * Windows: skip remote dependency checks, reduce Metro watcher ENOENT on ephemeral
 * native build dirs under node_modules (CMake / .cxx).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.EXPO_NO_DEPENDENCY_VALIDATION = '1';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

if (process.platform === 'win32') {
  process.env.CHOKIDAR_USEPOLLING = process.env.CHOKIDAR_USEPOLLING || '1';
  const cxx = join(root, 'node_modules', 'expo-modules-core', 'android', '.cxx');
  if (existsSync(cxx)) {
    try {
      rmSync(cxx, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

const passThrough = process.argv.slice(2);
const result = spawnSync('npx', ['expo', 'start', ...passThrough], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
  cwd: root,
});

process.exit(result.status === null ? 1 : result.status);
