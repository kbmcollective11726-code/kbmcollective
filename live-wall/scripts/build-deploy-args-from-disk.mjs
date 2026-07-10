#!/usr/bin/env node
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PATHS = [
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

const files = PATHS.map((file) => ({
  file,
  data: readFileSync(join(root, file), 'utf8'),
}));

const args = {
  target: 'production',
  name: 'live-wall',
  teamId: 'team_9FdwKI9UT4vqVAoQQYThQXhw',
  projectSettings: { framework: 'nextjs' },
  files,
};

process.stdout.write(JSON.stringify(args));
