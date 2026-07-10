#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = JSON.parse(readFileSync(join(__dirname, '.mcp-call-ready.json'), 'utf8'));
if (args.files.length !== 14) {
  console.error(`Expected 14 files, got ${args.files.length}`);
  process.exit(1);
}
writeFileSync(join(__dirname, '.mcp-deploy-args-only.json'), JSON.stringify(args), 'utf8');
console.log('ready', args.files.length, 'files');
