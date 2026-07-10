#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '.deploy-full-args.json');
const json = execFileSync(process.execPath, [join(__dirname, 'build-mcp-deploy-args.mjs')], {
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024,
});
const args = JSON.parse(json);
if (args.files.length !== 14) {
  console.error(`Expected 14 files, got ${args.files.length}`);
  process.exit(1);
}
writeFileSync(out, json, 'utf8');
console.log(`Wrote ${out} (${Buffer.byteLength(json, 'utf8')} bytes, ${args.files.length} files)`);
