#!/usr/bin/env node
/**
 * Fix app icons to be square (1024×1024) as required by Expo.
 * Run: node scripts/fix-icons.mjs
 */
import sharp from 'sharp';
import { existsSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const assets = join(root, 'assets');

const ICONS = ['icon.png', 'adaptive-icon.png'];
const SIZE = 1024;

async function fixIcon(name) {
  const inputPath = join(assets, name);
  const tmpPath = join(assets, `.${name}.tmp`);
  if (!existsSync(inputPath)) {
    console.warn(`Skip ${name}: file not found`);
    return;
  }
  await sharp(inputPath)
    .resize(SIZE, SIZE, { fit: 'cover', position: 'center' })
    .png()
    .toFile(tmpPath);
  renameSync(tmpPath, inputPath);
  console.log(`✓ Fixed ${name} → ${SIZE}×${SIZE}`);
}

async function main() {
  for (const name of ICONS) {
    await fixIcon(name);
  }
  console.log('Done. Run: npx expo-doctor');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
