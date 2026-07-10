#!/usr/bin/env node
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const FILES = [
  'package.json',
  'package-lock.json',
  'next.config.js',
  'tsconfig.json',
  'next-env.d.ts',
  'next-internals.d.ts',
  'app/layout.tsx',
  'app/page.tsx',
  'app/wall/page.tsx',
  'app/wall/WallPageContent.tsx',
  'lib/supabase.ts',
  'lib/scheduleNowNext.ts',
  'lib/sponsorImageUrl.ts',
  'lib/sponsorCreatives.ts',
];

const args = {
  target: 'production',
  name: 'live-wall',
  teamId: 'team_9FdwKI9UT4vqVAoQQYThQXhw',
  projectSettings: { framework: 'nextjs' },
  files: FILES.map((file) => ({
    file,
    data: readFileSync(join(root, file), 'utf8'),
  })),
};

if (args.files.length !== 14) {
  console.error(`Expected 14 files, got ${args.files.length}`);
  process.exit(1);
}

process.stdout.write(JSON.stringify(args));
