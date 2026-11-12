/**
 * Rebuild Android adaptive foreground so "CONNECT" stays inside the safe zone.
 * Android masks crop ~18% on each edge; iOS icon.png is left unchanged.
 *
 * Run: node scripts/make-adaptive-icon-safe.mjs
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const input = path.join(root, 'assets', 'icon.png');
const output = path.join(root, 'assets', 'adaptive-icon-safe.png');

const SIZE = 1024;
/** Android safe zone ≈ center 66%; keep logo smaller so CONNECT clears round masks. */
const SAFE_FRACTION = 0.5;
/** Shift logo slightly up so bottom text clears the mask curve. */
const NUDGE_UP_FRACTION = 0.04;
const BLACK_THRESHOLD = 35;

async function contentBounds(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
      const a = data[i + 3];
      if (a > 8 && (r > BLACK_THRESHOLD || g > BLACK_THRESHOLD || b > BLACK_THRESHOLD)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX > maxX || minY > maxY) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function main() {
  const source = await sharp(input).resize(SIZE, SIZE, { fit: 'cover' }).ensureAlpha().png().toBuffer();
  const bounds = await contentBounds(source);
  if (!bounds) throw new Error('Could not detect logo content in icon.png');

  const logo = await sharp(source)
    .extract({
      left: bounds.minX,
      top: bounds.minY,
      width: bounds.width,
      height: bounds.height,
    })
    .png()
    .toBuffer();

  const maxSide = Math.floor(SIZE * SAFE_FRACTION);
  const scale = Math.min(maxSide / bounds.width, maxSide / bounds.height);
  const targetW = Math.max(1, Math.round(bounds.width * scale));
  const targetH = Math.max(1, Math.round(bounds.height * scale));

  const scaled = await sharp(logo).resize(targetW, targetH, { fit: 'inside' }).png().toBuffer();
  const left = Math.round((SIZE - targetW) / 2);
  const nudgeUp = Math.round(SIZE * NUDGE_UP_FRACTION);
  const top = Math.max(0, Math.round((SIZE - targetH) / 2) - nudgeUp);

  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{ input: scaled, left, top }])
    .png()
    .toFile(output);

  console.log(`Wrote ${path.relative(root, output)}`);
  console.log(`Logo content ${bounds.width}×${bounds.height} → scaled ${targetW}×${targetH} (safe ${Math.round(SAFE_FRACTION * 100)}%)`);
  console.log('iOS icon.png unchanged. Android uses adaptive-icon-safe.png from app.json.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
