/**
 * Applies rounded corners to the app icon (iOS-style ~22% radius, or rounder).
 * Reads assets/icon.png, outputs to icon-trimmed.png and adaptive-icon-trimmed.png.
 * Run from project root: node scripts/icon-round-edges.mjs
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const input = path.join(root, 'assets', 'icon.png');
const outputIcon = path.join(root, 'assets', 'icon-trimmed.png');
const outputAdaptive = path.join(root, 'assets', 'adaptive-icon-trimmed.png');

const SIZE = 1024;
const CORNER_RADIUS = 228; // standard iOS app icon (~22% of 1024), like the previous app icon

async function main() {
  const maskSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${CORNER_RADIUS}" ry="${CORNER_RADIUS}" fill="white"/>
</svg>`;

  const mask = Buffer.from(maskSvg);

  const image = await sharp(input)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .ensureAlpha()
    .toBuffer();

  const rounded = await sharp(image)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  await sharp(rounded).toFile(outputIcon);
  await sharp(rounded).toFile(outputAdaptive);
  console.log('Done. icon-trimmed.png and adaptive-icon-trimmed.png now have rounded corners.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
