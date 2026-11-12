// Create user accounts in bulk and/or link existing users to an event with per-row profile + role(s).
// Rows may include full_name, title, company (maps to public.users); roles → event_members.role + roles array.
// - Normal mode: default_password required; creates Auth users; duplicate emails → link + optional profile update.
// - link_only: no password; only existing public.users by email → update profile fields when provided, upsert event_members.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

const VALID_ROLES = ["attendee", "speaker", "vendor", "admin"] as const;

function mapRoleAlias(raw: string): string {
  const r = raw.trim().toLowerCase();
  if (r === "delegate" || r === "attendee") return "attendee";
  return r;
}

function normalizeRole(raw: string | undefined | null, fallback: string): string {
  const r = mapRoleAlias(String(raw ?? ""));
  return (VALID_ROLES as readonly string[]).includes(r) ? r : fallback;
}

/** Prefer registration/admin primary; speaker is an overlay when both apply. */
function primaryRole(roles: string[]): string {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("vendor")) return "vendor";
  if (roles.includes("attendee")) return "attendee";
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
      const t = mapRoleAlias(String(x));
      if ((VALID_ROLES as readonly string[]).includes(t) && !out.includes(t)) out.push(t);
    }
    if (out.length > 0) return out;
  }
  const raw = String(row.role ?? "").trim();
  if (!raw) return [normalizeRole("", fallback)];
  const parts = raw.split(",").map((s) => mapRoleAlias(s)).filter(Boolean);
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

type Row = {
  email: string;
  full_name?: string;
  title?: string;
  company?: string;
  role?: string;
  roles?: string[];
};

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
  const ch = corsHeaders(req, "Authorization, Content-Type, apikey");
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req, "Authorization, Content-Type, apikey");
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, ch);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Authorization required" }, 401, ch);
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
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
        title: typeof row.title === "string" ? row.title.trim() : undefined,
        company: typeof row.company === "string" ? row.company.trim() : undefined,
        role: row.role,
        roles: Array.isArray(row.roles)
          ? row.roles.map((x) => mapRoleAlias(String(x)))
          : undefined,
      };
    }).filter((r) => r.email.length > 0);
  } else if (Array.isArray(body.emails) && body.emails.length > 0) {
    rows = body.emails.map((e) => ({
      email: String(e).trim().toLowerCase(),
      role: legacyRole,
    }));
  }

  if (rows.length === 0) {
    return json({ error: "rows (or emails) is required and must not be empty" }, 400, ch);
  }
  if (linkOnly && !eventId) {
    return json({ error: "event_id is required for link-only import" }, 400, ch);
  }
  if (!linkOnly && defaultPassword.length < 8) {
    return json({ error: "default_password must be at least 8 characters" }, 400, ch);
  }

  const userJwt = authHeader.slice(7);
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller } } = await callerClient.auth.getUser(userJwt);
  if (!caller?.id) {
    return json({ error: "Invalid token" }, 401, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: platformAdmin } = await callerClient.rpc("is_platform_admin");
  const isPlatformAdmin = platformAdmin === true;

  if (eventId && !isPlatformAdmin) {
    const { data: eventAdmin } = await callerClient.rpc("is_event_admin", {
      p_event_id: eventId,
    });
    if (eventAdmin !== true) {
      return json({ error: "Only platform admins or event admins can bulk-create users" }, 403, ch);
    }
  } else if (!isPlatformAdmin) {
    return json({ error: "Platform admin or event admin required" }, 403, ch);
  }

  /** Event admins may not mint event-admin roles; only platform admins can. */
  function rolesAllowedForCaller(rolesList: string[]): string[] {
    if (isPlatformAdmin) return rolesList;
    const filtered = rolesList.filter((r) => r !== "admin");
    return filtered.length > 0 ? filtered : ["attendee"];
  }

  const errors: string[] = [];
  let created = 0;
  let linked = 0;

  function profilePatchFromRow(
    fullName: string | undefined,
    row: Row,
  ): Record<string, string> {
    const patch: Record<string, string> = {};
    if (fullName && fullName.length > 0) patch.full_name = fullName;
    const t = row.title?.trim();
    if (t) patch.title = t;
    const c = row.company?.trim();
    if (c) patch.company = c;
    return patch;
  }

  async function linkExistingUser(
    email: string,
    rolesList: string[],
    row: Row,
    fullNameForProfile: string | undefined,
  ): Promise<boolean> {
    const { data: prof } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    const userId = (prof as { id?: string } | null)?.id;
    if (!userId) {
      errors.push(`${email}: not found (user must sign up or use bulk create first)`);
      return false;
    }
    const patch = profilePatchFromRow(fullNameForProfile, row);
    if (Object.keys(patch).length > 0) {
      await admin.from("users").update(patch).eq("id", userId);
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
      const rolesList = rolesAllowedForCaller(rolesFromRow(row, "attendee"));
      const fullName = row.full_name && row.full_name.length > 0 ? row.full_name : undefined;
      const ok = await linkExistingUser(email, rolesList, row, fullName);
      if (ok) linked++;
    }
    return json({
      created: 0,
      linked,
      failed: errors.length,
      errors: errors.slice(0, 50),
    }, 200, ch);
  }

  const toMember: { user_id: string; roles: string[] }[] = [];

  for (const row of rows) {
    const email = row.email;
    if (!email.includes("@")) {
      errors.push(`Invalid email: ${email}`);
      continue;
    }
    const rolesList = rolesAllowedForCaller(rolesFromRow(row, legacyRole));
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
          const nameForProfile = row.full_name && row.full_name.length > 0 ? row.full_name : fullName;
          const ok = await linkExistingUser(email, rolesList, row, nameForProfile);
          if (ok) linked++;
        } else {
          errors.push(`${email}: ${error.message}`);
        }
        continue;
      }

      if (newUser?.user?.id) {
        created++;
        toMember.push({ user_id: newUser.user.id, roles: rolesList });
        const patch = profilePatchFromRow(fullName, row);
        if (Object.keys(patch).length > 0) {
          await admin.from("users").update(patch).eq("id", newUser.user.id);
        }
      }
    } catch (e) {
      errors.push(`${email}: ${e instanceof Error ? e.message : "Failed"}`);
    }
  }

  if (eventId && toMember.length > 0) {
    for (const m of toMember) {
      const { error: upErr } = await admin.from("event_members").upsert(
        {
          event_id: eventId,
          user_id: m.user_id,
          role: primaryRole(m.roles),
          roles: m.roles,
        },
        { onConflict: "event_id,user_id" },
      );
      if (upErr) {
        errors.push(`${m.user_id}: membership upsert failed: ${upErr.message}`);
        created = Math.max(0, created - 1);
      }
    }
  }

  return json({
    created,
    linked,
    failed: errors.length,
    errors: errors.slice(0, 50),
  }, 200, ch);
});
