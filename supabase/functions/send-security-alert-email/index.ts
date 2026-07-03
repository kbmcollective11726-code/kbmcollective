// Send security alert emails to platform admins (orphan sign-ups, etc.).
// Set RESEND_API_KEY + SECURITY_ALERT_FROM_EMAIL in Edge Function secrets.
// Optional PLATFORM_ALERT_EMAILS=comma,separated,override@example.com
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
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("SECURITY_ALERT_FROM_EMAIL") ?? "KBM Connect <alerts@kbmcollective.org>";

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500);
  }

  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { subject?: string; html?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const html = typeof body.html === "string" ? body.html : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!subject || (!html && !text)) {
    return json({ error: "subject and html or text required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const override = Deno.env.get("PLATFORM_ALERT_EMAILS")?.split(",").map((e) => e.trim()).filter(Boolean) ?? [];
  let recipients = override;

  if (recipients.length === 0) {
    const { data: admins } = await admin
      .from("users")
      .select("email")
      .eq("is_platform_admin", true);
    recipients = (admins ?? [])
      .map((r) => (r as { email?: string }).email?.trim())
      .filter((e): e is string => !!e && e.includes("@"));
  }

  if (recipients.length === 0) {
    return json({ ok: true, emailed: 0, reason: "no_recipients" }, 200);
  }

  if (!resendKey) {
    return json({ ok: true, emailed: 0, reason: "RESEND_API_KEY not configured" }, 200);
  }

  let sent = 0;
  for (const to of recipients) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject,
        html: html || undefined,
        text: text || undefined,
      }),
    });
    if (res.ok) sent += 1;
    else console.error("Resend error", to, await res.text());
  }

  return json({ ok: true, emailed: sent }, 200);
});
