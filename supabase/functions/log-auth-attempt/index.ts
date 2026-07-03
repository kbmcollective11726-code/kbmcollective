// Log sign-in success/failure for platform security audit (mobile app + cadmin).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500);
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
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const success = body.success === true;
  const source = typeof body.source === "string" ? body.source.trim().slice(0, 64) : "unknown";
  const errorMessage = typeof body.error_message === "string"
    ? body.error_message.trim().slice(0, 500)
    : "";
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : null;

  if (!email || !email.includes("@")) {
    return json({ error: "email required" }, 400);
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
    return json({ ok: true, throttled: true }, 200);
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
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
    return json({ error: error.message }, 500);
  }

  return json({ ok: true }, 200);
});
