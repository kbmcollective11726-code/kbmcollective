// Notify event admins + registrant when a delegate/vendor/speaker submits registration.
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

function portalBaseUrl(): string {
  return (
    Deno.env.get("CONNECT_PORTAL_URL") ??
    Deno.env.get("PUBLIC_PORTAL_URL") ??
    Deno.env.get("ADMIN_APP_URL")?.replace(/\/+$/, "") ??
    "https://connect.kbmcollective.org"
  ).replace(/\/+$/, "");
}

function formatOpenAt(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  try {
    return new Date(iso).toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      timeZoneName: "short",
    });
  } catch {
    return null;
  }
}

function registrantConfirmationContent(opts: {
  eventName: string;
  fullName: string;
  attendeeLabel: string;
  rolePath: string;
  eventId: string;
  stage2Active: boolean;
  holdingMessage: string | null;
  expectedOpenAt: string | null;
}) {
  const base = portalBaseUrl();
  const loginUrl = `${base}/portal/${opts.eventId}/${opts.rolePath}/login`;
  const detailsUrl = `${base}/portal/${opts.eventId}/${opts.rolePath}/registration`;
  const greeting = opts.fullName ? `Hi ${opts.fullName},` : "Hi,";
  const openFormatted = formatOpenAt(opts.expectedOpenAt);

  let nextStepsHtml: string;
  let nextStepsText: string;

  if (opts.stage2Active) {
    nextStepsHtml = `<p>Your registration details are ready. Sign in with the email and password you chose, then complete your profile:</p>
<p style="margin:24px 0"><a href="${detailsUrl}" style="display:inline-block;background:#1e4f8a;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">Complete registration details</a></p>
<p style="color:#555;font-size:14px">Sign in first if prompted: <a href="${loginUrl}">${loginUrl}</a></p>`;
    nextStepsText = `Your registration details are ready.\n\nSign in: ${loginUrl}\nComplete your profile: ${detailsUrl}`;
  } else {
    const scheduleLine = openFormatted
      ? `Registration details are expected to open on ${openFormatted}.`
      : "Registration details are not open yet — your event organizer will turn them on soon.";
    const customNote = opts.holdingMessage?.trim()
      ? `\n\n${opts.holdingMessage.trim()}`
      : "";
    nextStepsHtml = `<p>${scheduleLine}${customNote ? `<br/><br/>${opts.holdingMessage!.trim()}` : ""}</p>
<p>When details are open, sign in with the email and password you chose:</p>
<p style="margin:24px 0"><a href="${loginUrl}" style="display:inline-block;background:#1e4f8a;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">Sign in to your portal</a></p>
<p style="color:#555;font-size:14px">Portal link: <a href="${loginUrl}">${loginUrl}</a></p>`;
    nextStepsText = `${scheduleLine}${customNote}\n\nSign in when ready: ${loginUrl}`;
  }

  const subject = `Thank you for registering — ${opts.eventName}`;
  const html = `<p>${greeting}</p>
<p>Thank you for registering for <strong>${opts.eventName}</strong> as a <strong>${opts.attendeeLabel.toLowerCase()}</strong>.</p>
<p>We received your registration and our team will review it.</p>
${nextStepsHtml}
<p style="color:#555;font-size:14px;margin-top:24px">If you did not register for this event, you can ignore this email.</p>`;
  const text = `${greeting}\n\nThank you for registering for ${opts.eventName} as a ${opts.attendeeLabel.toLowerCase()}.\n\nWe received your registration and our team will review it.\n\n${nextStepsText}\n\nIf you did not register for this event, you can ignore this email.`;

  return { subject, html, text };
}

async function sendEmail(
  resendKey: string,
  fromEmail: string,
  to: string,
  content: { subject: string; html: string; text: string },
): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromEmail, to: [to], subject: content.subject, html: content.html, text: content.text }),
  });
  if (!res.ok) console.error("Resend error", to, await res.text());
  return res.ok;
}

/** Fallback when Resend is not configured — uses Supabase Auth SMTP (Magic Link template). */
async function sendViaSupabaseMagicLink(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  redirectTo: string,
): Promise<boolean> {
  const res = await fetch(`${supabaseUrl}/auth/v1/otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      email,
      options: {
        email_redirect_to: redirectTo,
        should_create_user: false,
      },
    }),
  });
  if (!res.ok) {
    console.error("Supabase magic link email", res.status, await res.text());
    return false;
  }
  return true;
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
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
    .select("registration_notify_team_emails, delegate_stage2_active, vendor_stage2_active, stage2_holding_message, stage2_expected_open_at")
    .eq("event_id", sub.event_id)
    .maybeSingle();

  const settings = settingsRow as {
    registration_notify_team_emails?: string | null;
    delegate_stage2_active?: boolean;
    vendor_stage2_active?: boolean;
    stage2_holding_message?: string | null;
    stage2_expected_open_at?: string | null;
  } | null;

  const attendeeLabel =
    sub.attendee_type === "vendor" ? "Vendor" : sub.attendee_type === "user" ? "Speaker" : "Delegate";
  const rolePath = sub.attendee_type === "vendor" ? "vendor" : "delegate";
  const stage2Active =
    sub.attendee_type === "vendor"
      ? Boolean(settings?.vendor_stage2_active)
      : Boolean(settings?.delegate_stage2_active);

  const name = [sub.first_name, sub.last_name].filter(Boolean).join(" ") || "Registrant";
  const eventName = (eventRow as { name?: string } | null)?.name ?? "Event";

  let adminSent = 0;
  let registrantSent = 0;
  let registrantVia: string | null = null;

  const registrantEmail = sub.email?.trim().toLowerCase();
  const portalLoginUrl = `${portalBaseUrl()}/portal/${sub.event_id}/${rolePath}/login`;
  const portalDetailsUrl = `${portalBaseUrl()}/portal/${sub.event_id}/${rolePath}/registration`;
  const magicLinkRedirect = stage2Active ? portalDetailsUrl : portalLoginUrl;

  if (registrantEmail?.includes("@") && sub.attendee_type !== "user") {
    const content = registrantConfirmationContent({
      eventName,
      fullName: name,
      attendeeLabel,
      rolePath,
      eventId: sub.event_id,
      stage2Active,
      holdingMessage: settings?.stage2_holding_message ?? null,
      expectedOpenAt: settings?.stage2_expected_open_at ?? null,
    });

    if (resendKey) {
      if (await sendEmail(resendKey, fromEmail, registrantEmail, content)) {
        registrantSent = 1;
        registrantVia = "resend";
      }
    }

    if (registrantSent === 0 && supabaseUrl && anonKey) {
      if (await sendViaSupabaseMagicLink(supabaseUrl, anonKey, registrantEmail, magicLinkRedirect)) {
        registrantSent = 1;
        registrantVia = "supabase_magiclink";
      }
    }
  }

  if (resendKey) {
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

    for (const email of parseTeamEmails(settings?.registration_notify_team_emails)) {
      adminEmails.add(email);
    }

    const adminSubject = `${eventName}: new ${attendeeLabel.toLowerCase()} registration — ${name}`;
    const adminText = [
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

    const adminHtml = `<p>A new <strong>${attendeeLabel}</strong> registration was submitted for <strong>${eventName}</strong>.</p>
<ul>
<li><strong>Name:</strong> ${name}</li>
${sub.company_name ? `<li><strong>Company:</strong> ${sub.company_name}</li>` : ""}
${sub.job_title ? `<li><strong>Title:</strong> ${sub.job_title}</li>` : ""}
${sub.email ? `<li><strong>Email:</strong> ${sub.email}</li>` : ""}
</ul>
<p>Review submissions in Matchmaking setup in cadmin.</p>`;

    for (const to of adminEmails) {
      if (await sendEmail(resendKey, fromEmail, to, { subject: adminSubject, html: adminHtml, text: adminText })) {
        adminSent += 1;
      }
    }
  }

  if (!resendKey && registrantSent === 0 && adminSent === 0) {
    return json({
      ok: true,
      emailed: 0,
      registrant_emailed: 0,
      reason: "RESEND_API_KEY not configured and Supabase magic link fallback failed",
    }, 200);
  }

  return json({ ok: true, emailed: adminSent, registrant_emailed: registrantSent, registrant_via: registrantVia }, 200);
});
