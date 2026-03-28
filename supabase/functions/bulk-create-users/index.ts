// Create user accounts in bulk and/or link existing users to an event with per-row name + role(s).
// CSV may send comma-separated roles; we set event_members.role (primary) + event_members.roles (array).
// - Normal mode: default_password required; creates Auth users; duplicate emails → link + optional name update.
// - link_only: no password; only existing public.users by email → update full_name, upsert event_members.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_ROLES = ["attendee", "speaker", "vendor", "admin"] as const;

function normalizeRole(raw: string | undefined | null, fallback: string): string {
  const r = String(raw ?? "").trim().toLowerCase();
  return (VALID_ROLES as readonly string[]).includes(r) ? r : fallback;
}

/** Same priority as mobile admin-members (display / primary key). */
function primaryRole(roles: string[]): string {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("vendor")) return "vendor";
  if (roles.includes("speaker")) return "speaker";
  return roles[0] ?? "attendee";
}

/** CSV may send `roles` array or a single `role` string (comma-separated allowed). */
function rolesFromRow(
  row: { role?: string; roles?: string[] },
  fallback: string,
): string[] {
  if (Array.isArray(row.roles) && row.roles.length > 0) {
    const out: string[] = [];
    for (const x of row.roles) {
      const t = String(x).trim().toLowerCase();
      if ((VALID_ROLES as readonly string[]).includes(t) && !out.includes(t)) out.push(t);
    }
    if (out.length > 0) return out;
  }
  const raw = String(row.role ?? "").trim();
  if (!raw) return [normalizeRole("", fallback)];
  const parts = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const valid = parts.filter((p) => (VALID_ROLES as readonly string[]).includes(p));
  const deduped = [...new Set(valid)];
  if (deduped.length > 0) return deduped;
  return [normalizeRole(row.role, fallback)];
}

function derivedNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "User";
  return local.replace(/[._]/g, " ").trim() || "User";
}

function isAlreadyExistsError(err: { message?: string } | null): boolean {
  const m = (err?.message ?? "").toLowerCase();
  return (
    m.includes("already") ||
    m.includes("registered") ||
    m.includes("duplicate") ||
    m.includes("exists")
  );
}

type Row = { email: string; full_name?: string; role?: string; roles?: string[] };

type Body = {
  emails?: string[];
  rows?: Row[];
  default_password?: string;
  event_id?: string;
  /** If true, do not create accounts; only update name + event_members for existing users. */
  link_only?: boolean;
  /** Legacy: single role when using `emails` array without per-row roles. */
  role?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Authorization required" }, 401);
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : null;
  const linkOnly = body.link_only === true;
  const defaultPassword = typeof body.default_password === "string" ? body.default_password.trim() : "";
  const legacyRole = normalizeRole(body.role, "attendee");

  let rows: Row[] = [];
  if (Array.isArray(body.rows) && body.rows.length > 0) {
    rows = body.rows.map((r) => {
      const row = r as Row;
      return {
        email: String(row.email ?? "").trim().toLowerCase(),
        full_name: typeof row.full_name === "string" ? row.full_name.trim() : undefined,
        role: row.role,
        roles: Array.isArray(row.roles) ? row.roles.map((x) => String(x).trim().toLowerCase()) : undefined,
      };
    }).filter((r) => r.email.length > 0);
  } else if (Array.isArray(body.emails) && body.emails.length > 0) {
    rows = body.emails.map((e) => ({
      email: String(e).trim().toLowerCase(),
      role: legacyRole,
    }));
  }

  if (rows.length === 0) {
    return json({ error: "rows (or emails) is required and must not be empty" }, 400);
  }
  if (linkOnly && !eventId) {
    return json({ error: "event_id is required for link-only import" }, 400);
  }
  if (!linkOnly && defaultPassword.length < 8) {
    return json({ error: "default_password must be at least 8 characters" }, 400);
  }

  const userJwt = authHeader.slice(7);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller } } = await callerClient.auth.getUser(userJwt);
  if (!caller?.id) {
    return json({ error: "Invalid token" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile } = await admin.from("users").select("is_platform_admin").eq("id", caller.id).single();
  const isPlatformAdmin = (profile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;

  if (eventId && !isPlatformAdmin) {
    const { data: em } = await admin
      .from("event_members")
      .select("role")
      .eq("event_id", eventId)
      .eq("user_id", caller.id)
      .maybeSingle();
    const member = em as { role?: string } | null;
    const isEventAdmin = member?.role === "admin" || member?.role === "super_admin";
    if (!isEventAdmin) {
      return json({ error: "Only platform admins or event admins can bulk-create users" }, 403);
    }
  } else if (!isPlatformAdmin) {
    return json({ error: "Platform admin or event admin required" }, 403);
  }

  const errors: string[] = [];
  let created = 0;
  let linked = 0;

  async function linkExistingUser(
    email: string,
    fullName: string | undefined,
    rolesList: string[],
  ): Promise<boolean> {
    const { data: prof } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    const userId = (prof as { id?: string } | null)?.id;
    if (!userId) {
      errors.push(`${email}: not found (user must sign up or use bulk create first)`);
      return false;
    }
    if (fullName && fullName.length > 0) {
      await admin.from("users").update({ full_name: fullName }).eq("id", userId);
    }
    if (eventId) {
      const pr = primaryRole(rolesList);
      const { error: upErr } = await admin.from("event_members").upsert(
        {
          event_id: eventId,
          user_id: userId,
          role: pr,
          roles: rolesList,
        },
        { onConflict: "event_id,user_id" },
      );
      if (upErr) {
        errors.push(`${email}: ${upErr.message}`);
        return false;
      }
    }
    return true;
  }

  if (linkOnly) {
    for (const row of rows) {
      const email = row.email;
      if (!email.includes("@")) {
        errors.push(`Invalid email: ${email}`);
        continue;
      }
      const rolesList = rolesFromRow(row, "attendee");
      const fullName = row.full_name && row.full_name.length > 0 ? row.full_name : undefined;
      const ok = await linkExistingUser(email, fullName, rolesList);
      if (ok) linked++;
    }
    return json({
      created: 0,
      linked,
      failed: errors.length,
      errors: errors.slice(0, 50),
    }, 200);
  }

  const toMember: { user_id: string; roles: string[] }[] = [];

  for (const row of rows) {
    const email = row.email;
    if (!email.includes("@")) {
      errors.push(`Invalid email: ${email}`);
      continue;
    }
    const rolesList = rolesFromRow(row, legacyRole);
    const fullName = (row.full_name && row.full_name.length > 0) ? row.full_name : derivedNameFromEmail(email);

    try {
      const { data: newUser, error } = await admin.auth.admin.createUser({
        email,
        password: defaultPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, must_change_password: true },
      });

      if (error) {
        if (isAlreadyExistsError(error)) {
          const ok = await linkExistingUser(
            email,
            row.full_name && row.full_name.length > 0 ? row.full_name : fullName,
            rolesList,
          );
          if (ok) linked++;
        } else {
          errors.push(`${email}: ${error.message}`);
        }
        continue;
      }

      if (newUser?.user?.id) {
        created++;
        toMember.push({ user_id: newUser.user.id, roles: rolesList });
      }
    } catch (e) {
      errors.push(`${email}: ${e instanceof Error ? e.message : "Failed"}`);
    }
  }

  if (eventId && toMember.length > 0) {
    for (const m of toMember) {
      await admin.from("event_members").upsert(
        {
          event_id: eventId,
          user_id: m.user_id,
          role: primaryRole(m.roles),
          roles: m.roles,
        },
        { onConflict: "event_id,user_id" },
      );
    }
  }

  return json({
    created,
    linked,
    failed: errors.length,
    errors: errors.slice(0, 50),
  }, 200);
});
