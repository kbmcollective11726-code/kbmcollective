# Security audits

Dated ASVS reports and dependency preflights live here.

## How to re-run

**Full OWASP ASVS 5.0 audit (recommended before launch / major releases)**

In Cursor chat (from this repo):

```text
/kbm-security-audit
```

or:

```text
run KBM security audit
```

That loads `.cursor/skills/kbm-security-audit/`, runs dependency preflight, reviews the codebase against the ASVS checklist, and writes `YYYY-MM-DD-asvs.md` here.

**Dependency / secret preflight only (fast, automatable)**

```bash
npm run audit:security
```

Writes `YYYY-MM-DD-deps-preflight.md`.

## Files

| Pattern | Meaning |
|---------|---------|
| `YYYY-MM-DD-asvs.md` | Full ASVS scorecard + findings |
| `YYYY-MM-DD-deps-preflight.md` | npm audit + heuristic secret scan |
