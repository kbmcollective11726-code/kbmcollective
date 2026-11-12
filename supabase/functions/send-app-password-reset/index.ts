// Branded app password reset — always redirects to auth-recovery.html (opens mobile app).
// Prefers Resend when configured; otherwise Supabase Auth SMTP (/recover).
// Rate limits: 2/email/15m, 4/email/hour, 10/IP/hour. Blocked users never emailed.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const MAX_PER_EMAIL_15M = 2;
const MAX_PER_EMAIL_HOUR = 4;
const MAX_PER_IP_HOUR = 10;

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    null
  );
}

async function sendViaSupabaseSmtp(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  redirectTo: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const res = await fetch(`${supabaseUrl}/auth/v1/recover`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ email, redirect_to: redirectTo }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Supabase recover email", res.status, detail);
    return { error: "Could not send reset email.", status: res.status >= 500 ? 502 : 400 };
  }

  return { ok: true };
}

async function isRateLimited(
  admin: ReturnType<typeof createClient>,
  email: string,
  ip: string | null,
): Promise<boolean> {
  const now = Date.now();
  const since15m = new Date(now - 15 * 60 * 1000).toISOString();
  const since1h = new Date(now - 60 * 60 * 1000).toISOString();

  const { count: email15 } = await admin
    .from("password_reset_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", since15m);
  if ((email15 ?? 0) >= MAX_PER_EMAIL_15M) return true;

  const { count: email1h } = await admin
    .from("password_reset_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", since1h);
  if ((email1h ?? 0) >= MAX_PER_EMAIL_HOUR) return true;

  if (ip) {
    const { count: ip1h } = await admin
      .from("password_reset_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since1h);
    if ((ip1h ?? 0) >= MAX_PER_IP_HOUR) return true;
  }

  return false;
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
  const fromEmail =
    Deno.env.get("AUTH_EMAIL_FROM") ??
    Deno.env.get("REGISTRATION_FROM_EMAIL") ??
    Deno.env.get("SECURITY_ALERT_FROM_EMAIL") ??
    "KBM Connect <info@kbmcollective.org>";
  const cadminBase = (Deno.env.get("CADMIN_BASE_URL") ?? "https://cadmin.kbmcollective.org").replace(/\/+$/, "");
  const redirectTo = (Deno.env.get("APP_PASSWORD_RESET_REDIRECT_URL") ?? `${cadminBase}/auth-recovery.html`)
    .replace(/\/+$/, "");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return json({ error: "Valid email is required" }, 400, ch);
  }

  // Always respond success to avoid email enumeration / tip off rate limits.
  const okResponse = (extra?: object) => json({ ok: true, ...(extra ?? {}) }, 200);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const ip = clientIp(req);

  // Per-user block (platform admins can toggle on cadmin). Silent no-op when blocked.
  const { data: profile } = await admin
    .from("users")
    .select("id, password_reset_blocked")
    .ilike("email", email)
    .maybeSingle();
  if ((profile as { password_reset_blocked?: boolean } | null)?.password_reset_blocked === true) {
    console.log("password reset blocked for user", (profile as { id?: string }).id);
    return okResponse({ skipped: "blocked" });
  }

  if (await isRateLimited(admin, email, ip)) {
    console.log("password reset rate limited");
    return okResponse({ skipped: "rate_limited" });
  }

  // Record attempt before send so parallel requests still hit the limit.
  const { error: insErr } = await admin.from("password_reset_requests").insert({
    email,
    ip,
  });
  if (insErr) {
    console.error("password_reset_requests insert", insErr);
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    const msg = (linkErr?.message ?? "").toLowerCase();
    if (msg.includes("not found") || msg.includes("no user") || msg.includes("invalid")) {
      return okResponse();
    }
    console.error("generateLink", linkErr);
    const smtpOnly = await sendViaSupabaseSmtp(supabaseUrl, anonKey, email, redirectTo);
    if ("error" in smtpOnly) {
      console.error("password reset delivery failed (generateLink + smtp)");
      return okResponse({ skipped: "delivery_failed" });
    }
    return okResponse({ via: "supabase_smtp" });
  }

  const actionLink = linkData.properties.action_link;
  const hashedToken = (linkData.properties as { hashed_token?: string }).hashed_token;
  const webRecoveryLink = hashedToken
    ? `${redirectTo}?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`
    : actionLink;
  const meta = linkData.user?.user_metadata as { full_name?: string } | undefined;
  const displayName = (meta?.full_name ?? "").trim();
  const greeting = displayName ? `Hi ${displayName},` : "Hi,";

  if (!resendKey) {
    const smtpResult = await sendViaSupabaseSmtp(supabaseUrl, anonKey, email, redirectTo);
    if ("error" in smtpResult) {
      console.error("password reset delivery failed (no resend key + smtp)");
      return okResponse({ skipped: "delivery_failed" });
    }
    return okResponse({ via: "supabase_smtp" });
  }

  const subject = "Reset your KBM Connect password";
  const html = `<p>${greeting}</p>
<p>We received a request to reset the password for <strong>${email}</strong>.</p>
<p>Tap the button below to choose a new password in your browser, then sign in to KBM Connect.</p>
<p style="margin:24px 0"><a href="${webRecoveryLink}" style="display:inline-block;background:#1e4f8a;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">Reset my password</a></p>
<p style="color:#555;font-size:14px">Open this link on your phone. You will set your new password on the page that opens, then sign in to the app. Use your mail app (not Outlook's in-app browser).</p>
<p style="color:#555;font-size:14px">If you did not request this, you can ignore this email. The link expires after a short time.</p>`;
  const text =
    `${greeting}\n\nWe received a request to reset the password for ${email}.\n\nReset your password using this link on your phone:\n${webRecoveryLink}\n\nIf you did not request this, ignore this email.`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject,
      html,
      text,
    }),
  });

  const resendDetail = await res.text();
  let resendBody: { id?: string; message?: string; name?: string } | null = null;
  try {
    resendBody = resendDetail ? (JSON.parse(resendDetail) as { id?: string; message?: string; name?: string }) : null;
  } catch {
    resendBody = null;
  }

  if (!res.ok || !resendBody?.id) {
    console.error("Resend error", resendDetail.slice(0, 500));
    const smtpResult = await sendViaSupabaseSmtp(supabaseUrl, anonKey, email, redirectTo);
    if ("error" in smtpResult) {
      console.error("password reset delivery failed (resend + smtp)", resendDetail.slice(0, 300));
      return okResponse({ skipped: "delivery_failed" });
    }
    return okResponse({ via: "supabase_smtp_fallback" });
  }

  console.log("password reset emailed via resend", { messageId: resendBody.id, from: fromEmail.split("<").pop()?.replace(">", "") });
  return okResponse({ via: "resend" });
});
