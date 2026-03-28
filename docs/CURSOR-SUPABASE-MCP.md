# Supabase MCP in Cursor — why it sometimes “doesn’t run” + how to set it up

## Why the AI agent couldn’t use MCP

Two different things:

1. **MCP in Cursor (your IDE)** — When Supabase MCP is connected and **authorized**, **you** (or the chat UI that has MCP tools enabled) can run `list_tables`, `execute_sql`, etc. That depends on Cursor showing the server as connected under **Settings → Cursor Settings → Tools & MCP**.

2. **Automated agent / background tools** — Some Cursor agent runs (e.g. coding tasks that only get file + terminal tools) **do not receive MCP tool calls**. So the assistant may say it “can’t run MCP” even though **your** Cursor is configured correctly. **Fix:** use a chat mode that exposes MCP (e.g. ensure **Tools & MCP** shows Supabase green, then ask explicitly: *“Use the Supabase MCP tool to list tables”* and approve the tool prompt if asked).

So: **MCP is for Cursor + your login**, not a guarantee every sub-agent in every context gets those tools.

---

## Your project config (already valid)

`.cursor/mcp.json` uses Supabase’s **hosted MCP** scoped to your project:

```json
"url": "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF"
```

That matches [Supabase MCP docs](https://supabase.com/docs/guides/getting-started/mcp) (`project_ref` limits tools to one project).

### Optional: read-only SQL

If you want MCP `execute_sql` to use a read-only DB role (safer on real data), add:

`&read_only=true`

Example:

`https://mcp.supabase.com/mcp?project_ref=noydhokbswedvltjyenr&read_only=true`

---

## Setup checklist (do this once)

1. **Save** `.cursor/mcp.json` in the repo (or use **global** `~/.cursor/mcp.json` if you prefer all projects).
2. **Restart Cursor** (or reload window) after editing MCP config.
3. Open **Settings → Cursor Settings → Tools & MCP**.
4. Find **supabase** → ensure it’s **connected** (often you must **log in to Supabase** in the browser the first time — dynamic OAuth).
5. Test in chat:  
   *“Using Supabase MCP, list public tables.”*  
   Approve the tool if Cursor asks.

If it stays red / errors:

- Confirm you’re logged into the **Supabase org** that owns the project.
- Confirm `project_ref` in the URL matches **Project Settings → General → Reference ID**.
- Try removing `project_ref` temporarily to use org-wide tools, then narrow again (per docs).

---

## CI / no browser (advanced)

For scripts or environments without OAuth, Supabase documents a **Personal Access Token** + `Authorization: Bearer …` header. Cursor may not support custom headers in all versions — use **`npm run supabase:verify`** with `DATABASE_URL` in `.env` for scripted checks instead.

---

## Security (from Supabase)

- Prefer **dev/staging** projects for MCP, not production with sensitive data.
- Use **`read_only=true`** when possible.
- Review **each tool call** before approving in Cursor.

See: [Supabase MCP — security](https://supabase.com/docs/guides/getting-started/mcp#security-risks).
