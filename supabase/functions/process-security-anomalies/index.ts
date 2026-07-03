// Every ~5 min (pg_cron): detect brute-force patterns and alert platform admins.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-cron-secret",
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
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500);
  }

  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("process_brute_force_anomaly_alerts");
  if (error) {
    return json({ error: error.message }, 500);
  }

  const sent = (data as { sent?: number } | null)?.sent ?? 0;
  const cadminUrl = "https://cadmin.kbmcollective.org/platform/audit";

  if (sent > 0) {
    const subject = `[KBM] Security alert: ${sent} brute-force pattern(s) detected`;
    const text =
      `${sent} brute-force or credential-scanning pattern(s) were detected in the last 15 minutes.\n\n` +
      `Review in cadmin: ${cadminUrl}`;
    const html =
      `<p><strong>${sent}</strong> brute-force or credential-scanning pattern(s) were detected in the last 15 minutes.</p>` +
      `<p><a href="${cadminUrl}">Open Security audit in cadmin</a></p>`;

    try {
      await fetch(`${supabaseUrl}/functions/v1/send-security-alert-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
          "x-cron-secret": cronSecret,
        },
        body: JSON.stringify({ subject, text, html }),
      });
    } catch (e) {
      console.error("send-security-alert-email", e);
    }
  }

  return json({ ok: true, sent }, 200);
});
