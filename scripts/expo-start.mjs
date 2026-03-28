/**
 * Work around Expo CLI + Node undici: dependency validation can throw
 * "TypeError: Body is unusable: Body has already been read" on some setups.
 * @see https://github.com/expo/expo/issues (fetch response consumed twice)
 */
import { spawnSync } from 'node:child_process';

process.env.EXPO_NO_DEPENDENCY_VALIDATION = '1';

const passThrough = process.argv.slice(2);
const result = spawnSync('npx', ['expo', 'start', ...passThrough], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
