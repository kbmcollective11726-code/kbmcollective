// Notify event admins + team when a delegate/vendor/speaker submits registration.
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

function parseTeamEmails(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
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
  const fromEmail = Deno.env.get("REGISTRATION_FROM_EMAIL") ?? Deno.env.get("SECURITY_ALERT_FROM_EMAIL") ?? "KBM Connect <noreply@kbmcollective.org>";

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server configuration error" }, 500);
  }

  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { submission_id?: string; event_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const submissionId = typeof body.submission_id === "string" ? body.submission_id.trim() : "";
  if (!submissionId) {
    return json({ error: "submission_id required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: sub, error: subErr } = await admin
    .from("event_registration_submissions")
    .select("id, event_id, attendee_type, first_name, last_name, email, company_name, job_title, status, submitted_at")
    .eq("id", submissionId)
    .maybeSingle();

  if (subErr || !sub) {
    return json({ error: subErr?.message ?? "Submission not found" }, 404);
  }
  if (sub.status !== "submitted") {
    return json({ ok: true, skipped: "not_submitted" }, 200);
  }

  const { data: eventRow } = await admin
    .from("events")
    .select("name")
    .eq("id", sub.event_id)
    .maybeSingle();

  const { data: settingsRow } = await admin
    .from("event_matchmaking_settings")
    .select("registration_notify_team_emails")
    .eq("event_id", sub.event_id)
    .maybeSingle();

  const { data: adminMembers } = await admin
    .from("event_members")
    .select("user_id, role, roles")
    .eq("event_id", sub.event_id);

  const adminEmails = new Set<string>();
  const adminUserIds: string[] = [];
  for (const row of adminMembers ?? []) {
    const r = row as { user_id?: string; role?: string; roles?: string[] | null };
    const isAdmin =
      r.role === "admin" ||
      r.role === "super_admin" ||
      (Array.isArray(r.roles) && (r.roles.includes("admin") || r.roles.includes("super_admin")));
    if (isAdmin && r.user_id) adminUserIds.push(r.user_id);
  }

  if (adminUserIds.length > 0) {
    const { data: userRows } = await admin.from("users").select("email").in("id", adminUserIds);
    for (const u of userRows ?? []) {
      const email = (u as { email?: string }).email?.trim().toLowerCase();
      if (email?.includes("@")) adminEmails.add(email);
    }
  }

  for (const email of parseTeamEmails((settingsRow as { registration_notify_team_emails?: string } | null)?.registration_notify_team_emails)) {
    adminEmails.add(email);
  }

  const recipients = [...adminEmails];
  if (recipients.length === 0) {
    return json({ ok: true, emailed: 0, reason: "no_recipients" }, 200);
  }

  const attendeeLabel =
    sub.attendee_type === "vendor" ? "Vendor" : sub.attendee_type === "user" ? "Speaker" : "Delegate";
  const name = [sub.first_name, sub.last_name].filter(Boolean).join(" ") || "Registrant";
  const eventName = (eventRow as { name?: string } | null)?.name ?? "Event";
  const subject = `${eventName}: new ${attendeeLabel.toLowerCase()} registration — ${name}`;
  const text = [
    `A new ${attendeeLabel.toLowerCase()} registration was submitted for ${eventName}.`,
    "",
    `Name: ${name}`,
    sub.company_name ? `Company: ${sub.company_name}` : null,
    sub.job_title ? `Title: ${sub.job_title}` : null,
    sub.email ? `Email: ${sub.email}` : null,
    sub.submitted_at ? `Submitted: ${sub.submitted_at}` : null,
    "",
    "Review submissions in Matchmaking setup in cadmin.",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<p>A new <strong>${attendeeLabel}</strong> registration was submitted for <strong>${eventName}</strong>.</p>
<ul>
<li><strong>Name:</strong> ${name}</li>
${sub.company_name ? `<li><strong>Company:</strong> ${sub.company_name}</li>` : ""}
${sub.job_title ? `<li><strong>Title:</strong> ${sub.job_title}</li>` : ""}
${sub.email ? `<li><strong>Email:</strong> ${sub.email}</li>` : ""}
</ul>
<p>Review submissions in Matchmaking setup in cadmin.</p>`;

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
      body: JSON.stringify({ from: fromEmail, to: [to], subject, html, text }),
    });
    if (res.ok) sent += 1;
    else console.error("Resend error", to, await res.text());
  }

  return json({ ok: true, emailed: sent }, 200);
});
