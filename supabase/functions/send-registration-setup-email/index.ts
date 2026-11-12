// Delegate registration: email a set-password link via Supabase Auth SMTP.
// New email → Invite template. Existing auth account → Magic Link template (not Reset password).
// Optional: RESEND_API_KEY for fully custom HTML.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function registrationEmailContent(
  eventName: string,
  fullName: string,
  actionLink: string,
  roleLabel: 'delegate' | 'vendor',
  bannerUrl: string | null,
) {
  const subject = `Complete your registration — ${eventName}`;
  const greeting = fullName ? `Hi ${fullName},` : "Hi,";
  const portalName = roleLabel === 'vendor' ? 'vendor portal' : 'delegate portal';
  const safeName = eventName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const banner = bannerUrl?.trim() && /^https?:\/\//i.test(bannerUrl.trim())
    ? `<div style="margin:0 0 24px 0"><img src="${bannerUrl.trim().replace(/"/g, "")}" alt="${safeName}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:4px" /></div>`
    : "";
  const html = `${banner}<p>${greeting}</p>
<p>Thank you for registering for <strong>${safeName}</strong>.</p>
<p>Click the button below to choose your password and sign in to your ${portalName}.</p>
<p style="margin:24px 0"><a href="${actionLink}" style="display:inline-block;background:#1e4f8a;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">Complete registration</a></p>
<p style="color:#555;font-size:14px">If the button does not work, copy this link into your browser:<br/><a href="${actionLink}">${actionLink}</a></p>
<p style="color:#555;font-size:14px">This link expires after a short time. If it stops working, submit the registration form again to receive a new link.</p>`;
  const text =
    `${greeting}\n\nThank you for registering for ${eventName}.\n\nComplete your registration and choose your password using this link (expires after a short time):\n${actionLink}\n\nIf the link expires, submit the registration form again for a new link.`;
  return { subject, html, text };
}

function resolveFromEmail(custom: string | null | undefined, fallback: string): string {
  const trimmed = custom?.trim();
  if (!trimmed) return fallback;
  if (/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/.test(trimmed)) return trimmed;
  const named = trimmed.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+\.[^<>\s]+)>$/);
  if (named) return `${named[1].trim()} <${named[2].trim()}>`;
  return fallback;
}

async function sendViaResend(
  resendKey: string,
  fromEmail: string,
  email: string,
  content: { subject: string; html: string; text: string },
): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
  });

  if (!res.ok) {
    console.error("Resend error", await res.text());
    return false;
  }

  return true;
}

async function linkSubmissionUserId(
  admin: ReturnType<typeof createClient>,
  eventId: string,
  email: string,
  userId: string,
) {
  const { error } = await admin
    .from("event_registration_submissions")
    .update({ user_id: userId })
    .eq("event_id", eventId)
    .ilike("email", email)
    .is("user_id", null);
  if (error) console.error("linkSubmissionUserId", error);
}

async function findUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
) {
  const { data: listed, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1, filter: email });
  if (error) {
    console.error("listUsers", error);
    return null;
  }
  return listed?.users?.find((u) => (u.email ?? "").toLowerCase() === email) ?? null;
}

/** Magic Link email (customize in Supabase → Magic Link template). Not the Reset password template. */
async function sendViaSupabaseMagicLink(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  redirectTo: string,
): Promise<{ ok: true } | { error: string; status: number }> {
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
    const detail = await res.text();
    console.error("Supabase magic link email", res.status, detail);
    return { error: "Could not send registration email via Supabase Auth.", status: res.status >= 500 ? 502 : 400 };
  }

  return { ok: true };
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
  const defaultFrom =
    Deno.env.get("REGISTRATION_FROM_EMAIL") ??
    Deno.env.get("SECURITY_ALERT_FROM_EMAIL") ??
    "KBM Connect <noreply@kbmcollective.org>";
  const portalBase = (
    Deno.env.get("PUBLIC_PORTAL_BASE_URL") ??
    Deno.env.get("CONNECT_BASE_URL") ??
    "https://connect.kbmcollective.org"
  ).replace(/\/+$/, "");
  /** Static bridge page (portal-set-password.html) — must be in Supabase Auth redirect allow list. */
  const bridgeBase = (
    Deno.env.get("PORTAL_SET_PASSWORD_BRIDGE_BASE") ??
    portalBase
  ).replace(/\/+$/, "");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.slice(7) === anonKey) {
    return json({ error: "Authorization required" }, 401, ch);
  }

  let body: { event_id?: string; email?: string; full_name?: string; attendee_type?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }

  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const attendeeType = typeof body.attendee_type === "string" ? body.attendee_type.trim() : "attendee";

  if (!eventId || !email || !email.includes("@")) {
    return json({ error: "event_id and valid email are required" }, 400, ch);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user: caller },
    error: callerErr,
  } = await callerClient.auth.getUser(authHeader.slice(7));
  if (callerErr || !caller?.id) {
    return json({ error: "Invalid token" }, 401, ch);
  }

  const { data: platformAdmin } = await callerClient.rpc("is_platform_admin", {
    p_user_id: caller.id,
  });
  if (platformAdmin !== true) {
    const { data: eventAdmin } = await callerClient.rpc("is_event_admin", {
      p_event_id: eventId,
    });
    if (eventAdmin !== true) {
      return json({ error: "Only event or platform admins can send registration emails" }, 403, ch);
    }
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Must target an existing submission for this event (prevents arbitrary invite spam).
  const { data: submission, error: subErr } = await admin
    .from("event_registration_submissions")
    .select("id, email")
    .eq("event_id", eventId)
    .ilike("email", email)
    .maybeSingle();
  if (subErr) {
    return json({ error: subErr.message }, 500, ch);
  }
  if (!submission) {
    return json({ error: "No registration submission found for this email on this event" }, 404, ch);
  }

  // Rate limit: max 5 setup emails per email+event per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentSends } = await admin
    .from("platform_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "registration_setup_email")
    .eq("event_id", eventId)
    .eq("target_email", email)
    .gte("created_at", oneHourAgo);
  if ((recentSends ?? 0) >= 5) {
    return json({ error: "Too many registration emails for this address. Try again later." }, 429, ch);
  }

  const { data: settingsRow, error: settingsErr } = await admin
    .from("event_matchmaking_settings")
    .select("registration_open, registration_from_email")
    .eq("event_id", eventId)
    .maybeSingle();
  if (settingsErr) {
    return json({ error: settingsErr.message }, 500, ch);
  }
  if (!settingsRow?.registration_open) {
    return json({ error: "Registration is not open for this event" }, 403, ch);
  }

  const fromEmail = resolveFromEmail(
    (settingsRow as { registration_from_email?: string | null }).registration_from_email,
    defaultFrom,
  );

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

  const rolePath = attendeeType === "vendor" ? "vendor" : "delegate";
  const redirectTo =
    `${bridgeBase}/portal-set-password.html?event_id=${encodeURIComponent(eventId)}&role=${encodeURIComponent(rolePath)}`;
  const roleLabel = attendeeType === "vendor" ? "vendor" : "delegate";
  const userMetadata = {
    full_name: fullName || null,
    event_id: eventId,
    attendee_type: attendeeType,
  };

  const existingUser = await findUserByEmail(admin, email);

  if (existingUser) {
    await admin.auth.admin.updateUserById(existingUser.id, {
      user_metadata: { ...(existingUser.user_metadata ?? {}), ...userMetadata },
    });
    await linkSubmissionUserId(admin, eventId, email, existingUser.id);
  }

  let emailed = false;
  let via = "";

  if (resendKey) {
    if (!existingUser) {
      const tempPassword = crypto.randomUUID().replace(/-/g, "") + "Aa1!";
      const { error: createErr } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: userMetadata,
      });
      if (createErr) {
        console.error("createUser", createErr);
        return json({ error: createErr.message || "Could not create account" }, 400, ch);
      }
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (!linkErr && linkData?.properties?.action_link) {
      const sent = await sendViaResend(
        resendKey,
        fromEmail,
        email,
        registrationEmailContent(eventName, fullName, linkData.properties.action_link, roleLabel, bannerUrl),
      );
      if (sent) {
        emailed = true;
        via = "resend";
      }
    }
  }

  if (!emailed && !existingUser) {
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: userMetadata,
    });
    if (!inviteErr) {
      emailed = true;
      via = "supabase_invite";
    } else {
      const alreadyExists =
        inviteErr.message?.toLowerCase().includes("already") ||
        inviteErr.message?.toLowerCase().includes("exists") ||
        (inviteErr as { code?: string }).code === "email_exists";
      if (!alreadyExists) {
        console.error("inviteUserByEmail", inviteErr);
        return json({ error: inviteErr.message || "Could not send registration email" }, 400, ch);
      }
      console.warn("inviteUserByEmail: account exists, sending magic link instead");
    }
  }

  if (!emailed) {
    const magicResult = await sendViaSupabaseMagicLink(supabaseUrl, anonKey, email, redirectTo);
    if ("error" in magicResult) {
      return json({ error: magicResult.error }, magicResult.status);
    }
    emailed = true;
    via = "supabase_magiclink";
  }

  await admin.rpc("insert_platform_audit_log", {
    p_category: "admin",
    p_action: "registration_setup_email",
    p_actor_user_id: caller.id,
    p_target_user_id: existingUser?.id ?? null,
    p_target_email: email,
    p_target_name: fullName || null,
    p_event_id: eventId,
    p_ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    p_details: { via, source: "send-registration-setup-email" },
  });

  return json({ ok: true, emailed: true, via }, 200, ch);
});
