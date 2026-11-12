// Email registrants when Stage 2 and/or Meeting Requests are newly activated.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function portalBaseUrl(): string {
  return (
    Deno.env.get("CONNECT_PORTAL_URL") ??
    Deno.env.get("PUBLIC_PORTAL_URL") ??
    Deno.env.get("PUBLIC_PORTAL_BASE_URL") ??
    Deno.env.get("CONNECT_BASE_URL") ??
    "https://connect.kbmcollective.org"
  ).replace(/\/+$/, "");
}

function defaultFromEmail(): string {
  return (
    Deno.env.get("REGISTRATION_FROM_EMAIL") ??
    Deno.env.get("SECURITY_ALERT_FROM_EMAIL") ??
    "KBM Connect <noreply@kbmcollective.org>"
  );
}

function resolveFromEmail(custom: string | null | undefined, fallback: string): string {
  const trimmed = custom?.trim();
  if (!trimmed) return fallback;
  if (/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/.test(trimmed)) return trimmed;
  const named = trimmed.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+\.[^<>\s]+)>$/);
  if (named) return `${named[1].trim()} <${named[2].trim()}>`;
  return fallback;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailBannerHtml(bannerUrl: string | null | undefined, eventName: string): string {
  const url = bannerUrl?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return "";
  return `<div style="margin:0 0 24px 0">
<img src="${escapeHtml(url)}" alt="${escapeHtml(eventName)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:4px" />
</div>`;
}

type ActivationFlags = {
  delegate_stage2: boolean;
  vendor_stage2: boolean;
  meeting_requests: boolean;
};

function buildEmail(opts: {
  eventName: string;
  fullName: string;
  rolePath: "delegate" | "vendor";
  eventId: string;
  flags: ActivationFlags;
  bannerUrl: string | null;
}) {
  const base = portalBaseUrl();
  const loginUrl = `${base}/portal/${opts.eventId}/${opts.rolePath}/login`;
  const registrationUrl = `${base}/portal/${opts.eventId}/${opts.rolePath}/registration`;
  const meetingsUrl = `${base}/portal/${opts.eventId}/${opts.rolePath}/meetings/request`;
  const greeting = opts.fullName ? `Hi ${opts.fullName},` : "Hi,";
  const banner = emailBannerHtml(opts.bannerUrl, opts.eventName);

  const opened: string[] = [];
  if (
    (opts.rolePath === "delegate" && opts.flags.delegate_stage2) ||
    (opts.rolePath === "vendor" && opts.flags.vendor_stage2)
  ) {
    opened.push("Registration Details");
  }
  if (opts.flags.meeting_requests) {
    opened.push("Meeting Requests");
  }

  const openedLabel = opened.join(" and ");
  const subject = `${opts.eventName}: ${openedLabel} ${opened.length > 1 ? "are" : "is"} now open`;

  const bullets: string[] = [];
  const textLines: string[] = [];
  if (
    (opts.rolePath === "delegate" && opts.flags.delegate_stage2) ||
    (opts.rolePath === "vendor" && opts.flags.vendor_stage2)
  ) {
    bullets.push(
      `<li><strong>Registration Details</strong> — complete your profile: <a href="${registrationUrl}">${registrationUrl}</a></li>`,
    );
    textLines.push(`Registration Details: ${registrationUrl}`);
  }
  if (opts.flags.meeting_requests) {
    bullets.push(
      `<li><strong>Meeting Requests</strong> — request meetings: <a href="${meetingsUrl}">${meetingsUrl}</a></li>`,
    );
    textLines.push(`Meeting Requests: ${meetingsUrl}`);
  }

  const html = `${banner}<p>${greeting}</p>
<p>Good news — <strong>${escapeHtml(openedLabel)}</strong> ${opened.length > 1 ? "are" : "is"} now open for <strong>${escapeHtml(opts.eventName)}</strong>.</p>
<p>Sign in to your portal to continue:</p>
<ul>${bullets.join("")}</ul>
<p style="margin:24px 0"><a href="${loginUrl}" style="display:inline-block;background:#1e4f8a;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">Sign in to your portal</a></p>
<p style="color:#555;font-size:14px">Portal login: <a href="${loginUrl}">${loginUrl}</a></p>`;

  const text = `${greeting}

Good news — ${openedLabel} ${opened.length > 1 ? "are" : "is"} now open for ${opts.eventName}.

Sign in: ${loginUrl}
${textLines.join("\n")}
`;

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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401, ch);
  }

  let body: {
    event_id?: string;
    activate_delegate_stage2?: boolean;
    activate_vendor_stage2?: boolean;
    activate_meeting_requests?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }

  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  const flags: ActivationFlags = {
    delegate_stage2: Boolean(body.activate_delegate_stage2),
    vendor_stage2: Boolean(body.activate_vendor_stage2),
    meeting_requests: Boolean(body.activate_meeting_requests),
  };

  if (!eventId || (!flags.delegate_stage2 && !flags.vendor_stage2 && !flags.meeting_requests)) {
    return json({ error: "event_id and at least one activation flag are required" }, 400, ch);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json({ error: "Unauthorized" }, 401, ch);
  }

  const { data: isPlatformAdmin } = await userClient.rpc("is_platform_admin");
  const { data: isEventAdmin } = await userClient.rpc("is_event_admin", { p_event_id: eventId });
  if (!isPlatformAdmin && !isEventAdmin) {
    return json({ error: "Forbidden" }, 403, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  if (!resendKey) {
    return json({ ok: true, emailed: 0, reason: "RESEND_API_KEY not configured" }, 200, ch);
  }

  const { data: eventRow } = await admin
    .from("events")
    .select("name, portal_banner_url, banner_url, logo_url")
    .eq("id", eventId)
    .maybeSingle();
  const event = eventRow as {
    name?: string;
    portal_banner_url?: string | null;
    banner_url?: string | null;
    logo_url?: string | null;
  } | null;
  const eventName = event?.name ?? "your event";
  const bannerUrl =
    event?.portal_banner_url?.trim() ||
    event?.banner_url?.trim() ||
    event?.logo_url?.trim() ||
    null;

  const { data: settingsRow } = await admin
    .from("event_matchmaking_settings")
    .select("registration_from_email")
    .eq("event_id", eventId)
    .maybeSingle();
  const fromEmail = resolveFromEmail(
    (settingsRow as { registration_from_email?: string | null } | null)?.registration_from_email,
    defaultFromEmail(),
  );

  const types: string[] = [];
  if (flags.delegate_stage2 || flags.meeting_requests) types.push("attendee");
  if (flags.vendor_stage2 || flags.meeting_requests) types.push("vendor");

  const { data: submissions, error: subErr } = await admin
    .from("event_registration_submissions")
    .select("email, first_name, last_name, attendee_type")
    .eq("event_id", eventId)
    .eq("status", "submitted")
    .in("attendee_type", types.length ? types : ["attendee", "vendor"]);

  if (subErr) {
    return json({ error: subErr.message }, 500, ch);
  }

  let emailed = 0;
  const seen = new Set<string>();

  for (const row of submissions ?? []) {
    const sub = row as {
      email?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      attendee_type?: string | null;
    };
    const email = sub.email?.trim().toLowerCase();
    if (!email?.includes("@") || seen.has(email)) continue;

    const isVendor = sub.attendee_type === "vendor";
    const rolePath: "delegate" | "vendor" = isVendor ? "vendor" : "delegate";

    // Only email this person if at least one activated feature applies to them
    const applies =
      (flags.meeting_requests) ||
      (flags.delegate_stage2 && !isVendor) ||
      (flags.vendor_stage2 && isVendor);
    if (!applies) continue;

    const personFlags: ActivationFlags = {
      delegate_stage2: flags.delegate_stage2 && !isVendor,
      vendor_stage2: flags.vendor_stage2 && isVendor,
      meeting_requests: flags.meeting_requests,
    };
    if (!personFlags.delegate_stage2 && !personFlags.vendor_stage2 && !personFlags.meeting_requests) {
      continue;
    }

    const fullName = [sub.first_name, sub.last_name].filter(Boolean).join(" ");
    const content = buildEmail({
      eventName,
      fullName,
      rolePath,
      eventId,
      flags: personFlags,
      bannerUrl,
    });

    seen.add(email);
    if (await sendEmail(resendKey, fromEmail, email, content)) {
      emailed += 1;
    }
  }

  return json({ ok: true, emailed, candidates: seen.size, from: fromEmail }, 200, ch);
});
