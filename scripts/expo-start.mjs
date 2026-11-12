/**
 * Work around Expo CLI + Node undici: dependency validation can throw
 * "TypeError: Body is unusable: Body has already been read" on some setups.
 *
 * Windows: skip remote dependency checks, reduce Metro watcher ENOENT on ephemeral
 * native build dirs under node_modules (CMake / .cxx / Gradle plugin build).
 * Also force Expo Go + advertise LAN IP so phone QR works.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

process.env.EXPO_NO_DEPENDENCY_VALIDATION = '1';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

if (process.platform === 'win32') {
  process.env.CHOKIDAR_USEPOLLING = process.env.CHOKIDAR_USEPOLLING || '1';
  const ephemeralWatchDirs = [
    join(root, 'node_modules', 'expo-modules-core', 'android', '.cxx'),
    join(root, 'node_modules', 'expo-modules-core', 'expo-module-gradle-plugin', 'build'),
  ];
  for (const dir of ephemeralWatchDirs) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
        console.log('[expo-start] Cleared ephemeral watch dir');
      } catch {
        /* ignore */
      }
    }
  }
}

function detectLanIp() {
  const forced = (process.env.REACT_NATIVE_PACKAGER_HOSTNAME || '').trim();
  const looksLikeTunnel = /trycloudflare\.com|ngrok|\.exp\.direct/i.test(forced);
  if (forced && !looksLikeTunnel) {
    return forced;
  }
  if (looksLikeTunnel) {
    console.log(
      `[expo-start] Ignoring stale tunnel hostname (${forced}); using Wi-Fi LAN IP instead.`,
    );
    delete process.env.REACT_NATIVE_PACKAGER_HOSTNAME;
  }
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      const ip = net.address;
      if (ip.startsWith('169.254.')) continue;
      if (ip.startsWith('192.168.137.')) continue;
      if (!(ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip))) {
        continue;
      }
      const lower = name.toLowerCase();
      let score = 0;
      if (lower.includes('wi-fi') || lower.includes('wifi') || lower.includes('wlan')) score += 30;
      if (lower.includes('ethernet')) score += 20;
      if (lower.includes('local area connection')) score -= 20;
      if (ip.startsWith('192.168.')) score += 5;
      candidates.push({ ip, score, name });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.ip || '';
}

const lanIp = detectLanIp();
if (lanIp) {
  process.env.REACT_NATIVE_PACKAGER_HOSTNAME = lanIp;
  console.log(`[expo-start] Advertising to Expo Go via ${lanIp}`);
}

const passThrough = process.argv.slice(2);
const hasConnectionFlag = passThrough.some((a) =>
  ['--tunnel', '--lan', '--localhost', '--offline'].includes(a),
);
const hasGoFlag = passThrough.includes('--go');
const args = [...passThrough];
if (!hasGoFlag) args.unshift('--go');
if (!hasConnectionFlag) args.push('--lan');

const result = spawnSync('npx', ['expo', 'start', ...args], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
  cwd: root,
});

process.exit(result.status === null ? 1 : result.status);
