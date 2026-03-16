# Run Supabase SQL from Cursor (or terminal)

One-time setup so you (or Cursor) can run SQL against your Supabase database from the project.

## 1. Get your database URL

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your **CollectiveLive** project.
2. Go to **Project Settings** (gear) → **Database**.
3. Under **Connection string**, choose **URI**.
4. Copy the URI. It looks like:
   ```txt
   postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with your **database password** (same one you use for DB access in the dashboard).

## 2. Add it to `.env`

In your project root, open `.env` and add (use your real URI and keep the file private):

```env
DATABASE_URL=postgresql://postgres.xxxxx:YOUR_PASSWORD@aws-0-us-east-2.pooler.supabase.com:6543/postgres
```

Or use the variable name `SUPABASE_DB_URL` instead of `DATABASE_URL` — both work.

**Security:** `.env` is in `.gitignore`. Do not commit it or share the URL (it contains your DB password).

## 3. Run SQL from Cursor or terminal

From the project root you can run:

| Command | What it runs |
|--------|-------------------------------|
| `npm run supabase:run-sql` | `supabase/ENSURE-ALL-TABLES.sql` (tables, columns, RLS) |
| `npm run supabase:fix-recursion` | `supabase/FIX-GROUP-RECURSION.sql` (group chat recursion fix) |
| `npm run supabase:check-tables` | Check that required tables/columns exist (read-only) |

**Custom file:**

```bash
node scripts/run-supabase-sql.mjs supabase/RUN-IN-SQL-EDITOR.sql
# or
SUPABASE_SQL_FILE=supabase/FIX-GROUP-RECURSION.sql npm run supabase:run-sql
```

In Cursor, you can ask the AI to “run the recursion fix” and it can run `npm run supabase:fix-recursion` in the terminal for you — as long as `DATABASE_URL` is set in `.env`.

## 4. Summary

- **Connection** = `DATABASE_URL` (or `SUPABASE_DB_URL`) in `.env`.
- **Run SQL** = `npm run supabase:run-sql` or `npm run supabase:fix-recursion` (or the custom file commands above).
- Cursor can run these npm scripts from the terminal; it cannot connect to Supabase without this `.env` setup.
