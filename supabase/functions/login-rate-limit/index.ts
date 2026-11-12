/**
 * Login rate limits for mobile, cadmin, and portals.
 * Actions: check | record
 * - IP: 20 failed / trusted gateway IP / hour
 * - Account: 5 failed / email / 15 minutes (cooldown)
 *
 * Auth: anon apikey only (no client-shipped shared secret).
 * Residual: a hostile client can report failures, but IP write caps + IP lockout
 * bound how many accounts one network can lock before itself is blocked.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import {
  isProjectAnonCredential,
  presentedAnonKey,
  projectRefFromSupabaseUrl,
} from "../_shared/projectAnon.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const MAX_FAIL_IP_HOUR = 20;
const MAX_FAIL_EMAIL_WINDOW = 5;
const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_RECORD_WRITES_IP_HOUR = 40;
const LOCK_MESSAGE_IP = "Too many sign-in attempts from this network. Try again later.";
const LOCK_MESSAGE_EMAIL =
  "Too many sign-in attempts for this account. Try again in 15 minutes.";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    null
  );
}

async function isIpBlocked(
  admin: ReturnType<typeof createClient>,
  ip: string | null,
): Promise<boolean> {
  if (!ip) return false;
  const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: ipFails } = await admin
    .from("auth_login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("success", false)
    .gte("created_at", since1h);
  return (ipFails ?? 0) >= MAX_FAIL_IP_HOUR;
}

async function isEmailBlocked(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<boolean> {
  const since = new Date(Date.now() - EMAIL_WINDOW_MS).toISOString();
  const { count } = await admin
    .from("auth_login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .eq("success", false)
    .gte("created_at", since);
  return (count ?? 0) >= MAX_FAIL_EMAIL_WINDOW;
}

async function ipWriteBudgetExceeded(
  admin: ReturnType<typeof createClient>,
  ip: string | null,
): Promise<boolean> {
  if (!ip) return false;
  const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("auth_login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", since1h);
  return (count ?? 0) >= MAX_RECORD_WRITES_IP_HOUR;
}

Deno.serve(async (req: Request) => {
  const ch = corsHeaders(req, "Authorization, Content-Type, apikey");
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req, "Authorization, Content-Type, apikey");
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, ch);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const projectRef = projectRefFromSupabaseUrl(supabaseUrl);
  const presented = presentedAnonKey(req);
  if (!anonKey || !isProjectAnonCredential(presented, anonKey, projectRef)) {
    return json({ error: "Unauthorized" }, 401, ch);
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  let body: {
    action?: string;
    email?: string;
    success?: boolean;
    source?: string;
  };
  try {
    body = await req.json();
  } catch {
    // Soft-allow check on bad JSON so fail-closed mobile clients are not locked out.
    return json({ ok: true, allowed: true, error: "Invalid JSON body" }, 200, ch);
  }

  const action = (body.action ?? "").trim().toLowerCase();
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@") || email.endsWith("@")) {
    // Prefer 200 soft-allow on check so older fail-closed clients are not locked out
    // by a malformed email (REACT-NATIVE-J). Reject record attempts still.
    if (action === "check") {
      return json({ ok: true, allowed: true }, 200, ch);
    }
    return json({ error: "Valid email is required" }, 400, ch);
  }
  if (action !== "check" && action !== "record") {
    return json({ error: "action must be check or record" }, 400, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const ip = clientIp(req);

  if (action === "check") {
    // Parallel counts — sequential queries were contributing to gateway 504s on cold starts.
    const [ipBlocked, emailBlocked] = await Promise.all([
      isIpBlocked(admin, ip),
      isEmailBlocked(admin, email),
    ]);
    if (ipBlocked) {
      return json({ ok: true, allowed: false, message: LOCK_MESSAGE_IP }, 200, ch);
    }
    if (emailBlocked) {
      return json({ ok: true, allowed: false, message: LOCK_MESSAGE_EMAIL }, 200, ch);
    }
    return json({ ok: true, allowed: true }, 200, ch);
  }

  // record
  const success = body.success === true;
  const source =
    typeof body.source === "string" ? body.source.trim().slice(0, 64) : "unknown";

  // Success records should come with a user JWT (not just anon).
  if (success) {
    if (!bearer || isProjectAnonCredential(bearer, anonKey, projectRef)) {
      return json({ error: "User session required for successful login records" }, 401, ch);
    }
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser(bearer);
    if (userError || !user?.email) {
      return json({ error: "Invalid session" }, 401, ch);
    }
    if (user.email.trim().toLowerCase() !== email) {
      return json({ error: "Email does not match session" }, 403, ch);
    }
  }

  const [alreadyIpBlocked, alreadyEmailBlocked, overWriteBudget] = await Promise.all([
    isIpBlocked(admin, ip),
    isEmailBlocked(admin, email),
    success ? Promise.resolve(false) : ipWriteBudgetExceeded(admin, ip),
  ]);
  const alreadyBlocked = alreadyIpBlocked || alreadyEmailBlocked;

  // Bound writes from one source. Once blocked, additional public reports are
  // discarded instead of allowing unbounded log amplification.
  if ((!alreadyBlocked && !overWriteBudget) || success) {
    const { error: insErr } = await admin.from("auth_login_attempts").insert({
      email,
      ip,
      success,
      source,
    });
    if (insErr) {
      console.error("auth_login_attempts insert", insErr);
    }
  }

  if (success) {
    return json({ ok: true, allowed: true }, 200, ch);
  }
  if (alreadyIpBlocked || (await isIpBlocked(admin, ip))) {
    return json({ ok: true, allowed: false, message: LOCK_MESSAGE_IP }, 200, ch);
  }
  if (alreadyEmailBlocked || (await isEmailBlocked(admin, email))) {
    return json({ ok: true, allowed: false, message: LOCK_MESSAGE_EMAIL }, 200, ch);
  }
  return json({ ok: true, allowed: true }, 200, ch);
});
