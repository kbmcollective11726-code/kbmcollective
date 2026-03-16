// Auto-deactivate events whose end_date was more than DAYS_AFTER_END_UNTIL_DEACTIVATE days ago.
// Matches app: lib/eventAccess.ts EVENT_ACCESS_DAYS_AFTER_END = 5. Invoke via cron daily. Use x-cron-secret if set.
const DAYS_AFTER_END_UNTIL_DEACTIVATE = 5;
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
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
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS_AFTER_END_UNTIL_DEACTIVATE);
  const cutoffDate = cutoff.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("events")
    .update({ is_active: false })
    .eq("is_active", true)
    .lt("end_date", cutoffDate)
    .select("id");

  if (error) {
    console.error("auto-deactivate-events error:", error);
    return json({ error: error.message }, 500);
  }

  const count = data?.length ?? 0;
  return json({ ok: true, deactivated: count });
});
