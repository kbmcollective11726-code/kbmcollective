/**
 * Adds "CONNECT" text at the bottom of the app icon (below the KBM circle).
 * Reads assets/icon.png, outputs to icon.png and adaptive-icon.png.
 * Run from project root: node scripts/icon-add-connect.mjs
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const input = path.join(root, 'assets', 'icon.png');
const outputIcon = path.join(root, 'assets', 'icon.png');
const outputAdaptive = path.join(root, 'assets', 'adaptive-icon.png');

const SIZE = 1024;
const GOLD = '#d4af37';

async function main() {
  const icon = await sharp(input)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .ensureAlpha()
    .toBuffer();

  const textSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <text
    x="512"
    y="900"
    text-anchor="middle"
    fill="${GOLD}"
    font-size="100"
    font-weight="700"
    font-family="Arial, Helvetica, sans-serif"
  >CONNECT</text>
</svg>`;

  const textLayer = await sharp(Buffer.from(textSvg))
    .resize(SIZE, SIZE)
    .png()
    .toBuffer();

  const result = await sharp(icon)
    .composite([{ input: textLayer, blend: 'over' }])
    .png()
    .toBuffer();

  await sharp(result).toFile(outputIcon);
  await sharp(result).toFile(outputAdaptive);
  console.log('Done. "CONNECT" added at bottom of app icon (icon.png and adaptive-icon.png).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
