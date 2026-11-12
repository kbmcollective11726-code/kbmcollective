// Log sign-in success/failure for platform security audit (mobile app + cadmin + portals).
// Success rows require a user JWT whose email matches the claimed email.
// Failures require project anon apikey only (no client-shipped shared secret).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import {
  isProjectAnonCredential,
  presentedAnonKey,
  projectRefFromSupabaseUrl,
} from "../_shared/projectAnon.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
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
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const projectRef = projectRefFromSupabaseUrl(supabaseUrl);
  const presented = presentedAnonKey(req);
  if (!isProjectAnonCredential(presented, anonKey, projectRef)) {
    return json({ error: "Unauthorized" }, 401, ch);
  }

  let body: {
    email?: string;
    success?: boolean;
    source?: string;
    error_message?: string;
    user_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }

  let email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const success = body.success === true;
  const source = typeof body.source === "string" ? body.source.trim().slice(0, 64) : "unknown";
  const errorMessage = typeof body.error_message === "string"
    ? body.error_message.trim().slice(0, 500)
    : "";
  let userId = typeof body.user_id === "string" ? body.user_id.trim() : null;

  if (!email || !email.includes("@")) {
    return json({ error: "email required" }, 400, ch);
  }

  // Successful logins must be attested by a real user JWT (prevents fake success noise).
  if (success) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "User session required for successful login logs" }, 401, ch);
    }
    const token = authHeader.slice(7);
    if (isProjectAnonCredential(token, anonKey, projectRef)) {
      return json({ error: "User session required for successful login logs" }, 401, ch);
    }
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser(token);
    if (userError || !user?.id || !user.email) {
      return json({ error: "Invalid session" }, 401, ch);
    }
    const jwtEmail = user.email.trim().toLowerCase();
    if (jwtEmail !== email) {
      return json({ error: "Email does not match session" }, 403, ch);
    }
    email = jwtEmail;
    userId = user.id;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("platform_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("target_email", email)
    .eq("action", success ? "login_success" : "login_failed")
    .gte("created_at", oneHourAgo);

  if ((count ?? 0) > 30) {
    return json({ ok: true, throttled: true }, 200, ch);
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    null;

  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const { data: profile } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    resolvedUserId = (profile as { id?: string } | null)?.id ?? null;
  }

  const { error } = await admin.rpc("insert_platform_audit_log", {
    p_category: "auth",
    p_action: success ? "login_success" : "login_failed",
    p_actor_user_id: resolvedUserId,
    p_target_user_id: resolvedUserId,
    p_target_email: email,
    p_target_name: null,
    p_event_id: null,
    p_ip_address: ip,
    p_details: {
      source,
      ...(errorMessage ? { error_message: errorMessage } : {}),
    },
  });

  if (error) {
    console.error("insert_platform_audit_log error:", error);
    return json({ error: error.message }, 500, ch);
  }

  return json({ ok: true }, 200, ch);
});
