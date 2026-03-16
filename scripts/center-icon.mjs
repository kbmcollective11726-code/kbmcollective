#!/usr/bin/env node
/**
 * Centers the app icon logo within its black background.
 * Run: node scripts/center-icon.mjs
 */
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ICON_PATH = join(ROOT, 'assets', 'icon.png');
const ADAPTIVE_PATH = join(ROOT, 'assets', 'adaptive-icon.png');

// Pixels darker than this are considered "background"
const BLACK_THRESHOLD = 25;

async function findLogoBounds(img) {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width, minY = height, maxX = 0, maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = channels === 4 ? data[i + 3] : 255;
      const isLogo = a > 10 && (r > BLACK_THRESHOLD || g > BLACK_THRESHOLD || b > BLACK_THRESHOLD);
      if (isLogo) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX > maxX || minY > maxY) return null;
  return { minX, minY, maxX, maxY, width, height };
}

async function centerIcon() {
  const iconPath = ICON_PATH;
  let adaptivePath = ADAPTIVE_PATH;

  try {
    const img = sharp(iconPath);
    const meta = await img.metadata();
    const w = meta.width ?? 1024;
    const h = meta.height ?? 1024;

    const bounds = await findLogoBounds(img);
    if (!bounds) {
      console.error('Could not detect logo bounds.');
      process.exit(1);
    }

    const logoW = bounds.maxX - bounds.minX + 1;
    const logoH = bounds.maxY - bounds.minY + 1;
    const logoCenterX = bounds.minX + logoW / 2;
    const logoCenterY = bounds.minY + logoH / 2;
    const canvasCenterX = w / 2;
    const canvasCenterY = h / 2;
    const offsetX = Math.round(canvasCenterX - logoCenterX);
    const offsetY = Math.round(canvasCenterY - logoCenterY);

    console.log(`Logo bounds: (${bounds.minX},${bounds.minY}) - (${bounds.maxX},${bounds.maxY})`);
    console.log(`Offset to center: (${offsetX}, ${offsetY})`);

    if (offsetX === 0 && offsetY === 0) {
      console.log('Logo is already centered.');
      return;
    }

    // Crop to logo region, then composite onto black background centered
    const logo = await img
      .extract({ left: bounds.minX, top: bounds.minY, width: logoW, height: logoH })
      .png()
      .toBuffer();

    const posX = Math.max(0, Math.round((w - logoW) / 2));
    const posY = Math.max(0, Math.round((h - logoH) / 2));

    const blackBg = sharp({
      create: {
        width: w,
        height: h,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    });

    const centered = await blackBg
      .composite([{ input: logo, left: posX, top: posY }])
      .png()
      .toBuffer();

    await sharp(centered).toFile(iconPath);
    console.log('Updated:', iconPath);

    try {
      await sharp(centered).toFile(adaptivePath);
      console.log('Updated:', adaptivePath);
    } catch {
      // adaptive-icon may not exist; that's ok
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

centerIcon();
