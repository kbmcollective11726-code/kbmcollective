#!/usr/bin/env node
/**
 * Automated dependency / secret hygiene preflight for KBM Connect security audits.
 * Usage: node scripts/security-audit-deps.mjs
 * Or:    npm run audit:security
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packages = [
  { name: 'mobile', cwd: root },
  { name: 'live-wall', cwd: join(root, 'live-wall') },
  { name: 'admin-setup', cwd: join(root, 'admin-setup') },
];

const stamp = new Date().toISOString().slice(0, 10);
const outDir = join(root, 'docs', 'security-audits');
mkdirSync(outDir, { recursive: true });

const results = [];

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: process.env,
  });
  return {
    code: r.status ?? 1,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

for (const pkg of packages) {
  if (!existsSync(join(pkg.cwd, 'package.json'))) {
    results.push({ name: pkg.name, skipped: true, reason: 'no package.json' });
    continue;
  }
  console.log(`\n=== npm audit — ${pkg.name} ===`);
  const audit = run('npm', ['audit', '--json'], pkg.cwd);
  let summary = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 };
  try {
    const parsed = JSON.parse(audit.stdout || '{}');
    const vulns = parsed.metadata?.vulnerabilities || parsed.vulnerabilities || {};
    if (typeof vulns === 'object' && vulns !== null) {
      if ('critical' in vulns || 'high' in vulns) {
        summary = {
          critical: vulns.critical || 0,
          high: vulns.high || 0,
          moderate: vulns.moderate || 0,
          low: vulns.low || 0,
          info: vulns.info || 0,
          total: vulns.total || 0,
        };
      }
    }
  } catch {
    // non-json fallback
  }
  const human = run('npm', ['audit', '--omit=dev'], pkg.cwd);
  console.log(human.stdout || human.stderr || '(no output)');
  results.push({
    name: pkg.name,
    skipped: false,
    exitCode: audit.code,
    summary,
    human: human.stdout || human.stderr,
  });
}

// Quick secret-pattern scan (heuristic; not a substitute for gitleaks)
console.log('\n=== heuristic secret scan (tracked source) ===');
// Look for hardcoded secret *values*, not env var *names* like SUPABASE_SERVICE_ROLE_KEY.
const secretPatterns = [
  { name: 'stripe-live', re: /sk_live_[A-Za-z0-9]{20,}/g },
  { name: 'stripe-test', re: /sk_test_[A-Za-z0-9]{20,}/g },
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'private-key-pem', re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g },
  // Long JWT-like strings assigned as literals (skip Deno.env / process.env usages)
  { name: 'hardcoded-jwt', re: /(?:service_role|secret|api[_-]?key|token)\s*[:=]\s*['"]eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}['"]/gi },
];
const scanRoots = ['app', 'lib', 'components', 'stores', 'admin-setup/src', 'live-wall/app', 'live-wall/lib', 'supabase/functions', 'scripts'];
const skipDirs = new Set(['node_modules', 'dist', '.git', '.expo', '.next', 'build', 'coverage']);
const secretHits = [];
const { readdirSync, readFileSync, statSync } = await import('node:fs');

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|json|env)$/i.test(name) && !name.endsWith('.map')) acc.push(p);
  }
  return acc;
}

for (const rel of scanRoots) {
  const abs = join(root, rel);
  for (const file of walk(abs)) {
    const relFile = file.replace(root + '\\', '').replace(root + '/', '');
    if (relFile.includes('docs' + '\\security-audits') || relFile.includes('docs/security-audits')) continue;
    if (relFile.endsWith('security-audit-deps.mjs')) continue;
    if (/\.env(\.|$)/.test(file) && !file.endsWith('.example')) {
      secretHits.push({ file: relFile, note: 'env file present (ensure gitignored)' });
      continue;
    }
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { name, re } of secretPatterns) {
      re.lastIndex = 0;
      if (re.test(text)) {
        secretHits.push({ file: relFile, pattern: name });
        break;
      }
    }
  }
}

if (secretHits.length === 0) {
  console.log('No heuristic secret matches in scanned source trees.');
} else {
  console.log(`Possible issues (${secretHits.length}):`);
  for (const h of secretHits.slice(0, 40)) {
    console.log(` - ${h.file}${h.note ? ` — ${h.note}` : ''}${h.pattern ? ` — ${h.pattern}` : ''}`);
  }
  if (secretHits.length > 40) console.log(` ... and ${secretHits.length - 40} more`);
}

const reportLines = [
  `# Dependency & Secret Preflight — ${stamp}`,
  '',
  'Generated by `npm run audit:security`. Pair with the full ASVS audit skill (`kbm-security-audit`).',
  '',
  '## npm audit summary',
  '',
  '| Package | Critical | High | Moderate | Low | Exit |',
  '|---------|----------|------|----------|-----|------|',
];

for (const r of results) {
  if (r.skipped) {
    reportLines.push(`| ${r.name} | — | — | — | — | skipped (${r.reason}) |`);
    continue;
  }
  const s = r.summary;
  reportLines.push(
    `| ${r.name} | ${s.critical} | ${s.high} | ${s.moderate} | ${s.low} | ${r.exitCode} |`,
  );
}

reportLines.push('', '## Heuristic secret scan', '');
if (secretHits.length === 0) {
  reportLines.push('No matches.');
} else {
  for (const h of secretHits) {
    reportLines.push(`- \`${h.file}\`${h.note ? ` — ${h.note}` : ''}`);
  }
}

reportLines.push(
  '',
  '## Next step',
  '',
  'In Cursor chat, run: **`/kbm-security-audit`** or say **"run KBM security audit"** to complete the full OWASP ASVS 5.0 report.',
  '',
);

const outPath = join(outDir, `${stamp}-deps-preflight.md`);
writeFileSync(outPath, reportLines.join('\n'), 'utf8');
console.log(`\nWrote ${outPath}`);

const hasHigh =
  results.some((r) => !r.skipped && ((r.summary.critical || 0) + (r.summary.high || 0) > 0)) ||
  secretHits.some((h) => h.pattern);
process.exit(hasHigh ? 1 : 0);
