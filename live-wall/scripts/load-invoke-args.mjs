#!/usr/bin/env node
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = JSON.parse(readFileSync(join(__dirname, '.mcp-invoke-args.json'), 'utf8'));
if (!args.files || args.files.length !== 14) {
  console.error(`Expected 14 files, got ${args.files?.length ?? 0}`);
  process.exit(1);
}
process.stdout.write(JSON.stringify(args));
