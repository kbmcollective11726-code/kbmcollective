/**
 * Reduces empty black space around the logo in the app icon.
 * Finds the bounding box of non-black content, crops with small padding, outputs 1024x1024.
 * Run from project root: node scripts/trim-icon-padding.mjs
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const input = path.join(root, 'assets', 'icon.png');
const outputIcon = path.join(root, 'assets', 'icon-trimmed.png');
const outputAdaptive = path.join(root, 'assets', 'adaptive-icon-trimmed.png');

const BLACK_THRESHOLD = 45; // pixels with R,G,B all <= this are considered "empty"
const PADDING_PERCENT = 0.018; // ~2% padding (minimal) so logo fills more of the icon
const MIN_PAD = 6; // minimum pixels padding to avoid cutting edges

async function main() {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const isContent = r > BLACK_THRESHOLD || g > BLACK_THRESHOLD || b > BLACK_THRESHOLD;
      if (isContent) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;
  const pad = Math.max(MIN_PAD, Math.floor(Math.min(contentWidth, contentHeight) * PADDING_PERCENT));
  const side = Math.min(
    width,
    height,
    Math.max(contentWidth, contentHeight) + 2 * pad
  );
  // Center the square crop on the content center
  let left = Math.floor(contentCenterX - side / 2);
  let top = Math.floor(contentCenterY - side / 2);
  left = Math.max(0, Math.min(left, width - side));
  top = Math.max(0, Math.min(top, height - side));

  const cropped = await sharp(input)
    .extract({ left, top, width: side, height: side })
    .resize(1024, 1024)
    .png()
    .toBuffer();

  await sharp(cropped).toFile(outputIcon);
  await sharp(cropped).toFile(outputAdaptive);
  console.log('Done. Created assets/icon-trimmed.png and assets/adaptive-icon-trimmed.png with less black space.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
