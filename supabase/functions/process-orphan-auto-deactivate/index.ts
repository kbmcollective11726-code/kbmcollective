// Daily (pg_cron): auto-deactivate orphan accounts per platform security policy.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
    return json({ error: "Unauthorized" }, 401, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("process_orphan_account_auto_deactivations", {
    p_min_account_age_days: 14,
    p_failed_login_threshold: 5,
    p_limit: 100,
  });

  if (error) {
    return json({ error: error.message }, 500, ch);
  }

  const result =
    (data as { deactivated?: number; user_ids?: unknown } | null) ?? {};
  const userIds = Array.isArray(result.user_ids)
    ? result.user_ids.filter((id): id is string => typeof id === "string")
    : [];
  let authBansFailed = 0;
  for (const userId of userIds) {
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: "876000h",
    });
    if (banError) {
      authBansFailed += 1;
      console.error("orphan account ban", userId, banError);
    }
    await admin
      .from("platform_admin_step_up_sessions")
      .delete()
      .eq("user_id", userId);
  }

  return json({ ok: true, ...result, auth_bans_failed: authBansFailed }, 200, ch);
});
