#!/usr/bin/env node
/**
 * Run before EAS iOS build: prints the build number from app.json so you confirm
 * it is greater than the last upload in App Store Connect (TestFlight / App Store).
 * Wired into: npm run build:ios:testflight
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = resolve(root, 'app.json');

if (!existsSync(appJsonPath)) {
  console.error('ios-build-preflight: app.json not found');
  process.exit(1);
}

const app = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const ios = app.expo?.ios ?? {};
const buildNumber = ios.buildNumber;
const version = app.expo?.version ?? '(unknown)';

console.log('');
console.log('—— iOS build preflight ——');
console.log(`  expo.version (marketing):  ${version}`);
console.log(`  expo.ios.buildNumber:      ${buildNumber ?? '(missing — set in app.json)'}`);
console.log('');
console.log('  Before uploading: open App Store Connect → your app → TestFlight / Activity');
console.log('  and confirm this buildNumber is STRICTLY GREATER than the last successful iOS build.');
console.log('  If not, edit app.json → expo.ios.buildNumber, then run the build again.');
console.log('');

if (!buildNumber || String(buildNumber).trim() === '') {
  process.exit(1);
}
