// Every ~10 min (pg_cron): alert platform admins about orphan sign-ups + email if configured.
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
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: candidates, error: qErr } = await admin
    .from("users")
    .select("id, email, full_name, created_at, is_platform_admin")
    .lt("created_at", cutoff)
    .or("is_platform_admin.is.null,is_platform_admin.eq.false")
    .order("created_at", { ascending: false })
    .limit(50);

  if (qErr) {
    return json({ error: qErr.message }, 500);
  }

  let processed = 0;
  for (const row of candidates ?? []) {
    const user = row as { id: string; email: string; full_name: string | null; created_at: string };
    const { count: memberCount } = await admin
      .from("event_members")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if ((memberCount ?? 0) > 0) continue;

    const { count: sentCount } = await admin
      .from("platform_security_alert_sent")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("alert_type", "orphan_signup");
    if ((sentCount ?? 0) > 0) continue;

    const { error: notifyErr } = await admin.rpc("notify_platform_admins_orphan_signup", {
      p_user_id: user.id,
      p_email: user.email,
      p_full_name: user.full_name ?? "",
    });
    if (notifyErr) {
      console.error("notify_platform_admins_orphan_signup", notifyErr);
      continue;
    }

    processed += 1;
    const cadminUrl = "https://cadmin.kbmcollective.org/platform/audit";
    const subject = `[KBM] Unrecognized sign-up: ${user.email}`;
    const text =
      `${user.full_name || "Unknown"} (${user.email}) signed up but is not on any event roster.\n\n` +
      `Signed up: ${user.created_at}\n\nReview in cadmin: ${cadminUrl}`;
    const html =
      `<p><strong>${user.full_name || "Unknown"}</strong> (` +
      `<a href="mailto:${user.email}">${user.email}</a>` +
      `) signed up but is not on any event roster.</p>` +
      `<p>Signed up: ${user.created_at}</p>` +
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

  return json({ ok: true, processed }, 200);
});
