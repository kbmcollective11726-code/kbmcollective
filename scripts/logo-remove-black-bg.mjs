/**
 * Makes the black background of assets/logo-full.png transparent.
 * Run from project root: node scripts/logo-remove-black-bg.mjs
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const input = path.join(root, 'assets', 'logo-full.png');
const output = path.join(root, 'assets', 'logo-full-transparent.png');

const BLACK_THRESHOLD = 50; // pixels with R,G,B all <= this become transparent

async function main() {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD) {
      data[i + 3] = 0;
    }
  }
  await sharp(data, { raw: { width, height, channels } })
    .png()
    .toFile(output);
  console.log('Done. assets/logo-full-transparent.png created with transparent background.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
