#!/usr/bin/env node
/**
 * Writes a tiny WAV (0.08s soft tone) for in-app notification feedback.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'assets', 'sounds');
mkdirSync(outDir, { recursive: true });

const sampleRate = 8000;
const durationSec = 0.08;
const numSamples = Math.floor(sampleRate * durationSec);
const freq = 880;
const dataSize = numSamples * 2;
const buffer = Buffer.alloc(44 + dataSize);

buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(dataSize, 40);

for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  const env = Math.min(1, i / 80) * Math.max(0, 1 - i / numSamples);
  const s = Math.sin(2 * Math.PI * freq * t) * 0.25 * env;
  const v = Math.max(-1, Math.min(1, s));
  buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}

const outPath = join(outDir, 'in-app-notification.wav');
writeFileSync(outPath, buffer);
console.log('Wrote', outPath, buffer.length, 'bytes');
