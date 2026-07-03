// Branded app password reset — always redirects to auth-recovery.html (opens mobile app).
// Prefers Resend when configured; otherwise Supabase Auth SMTP (/recover).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail =
    Deno.env.get("REGISTRATION_FROM_EMAIL") ??
    Deno.env.get("SECURITY_ALERT_FROM_EMAIL") ??
    "KBM Connect <noreply@kbmcollective.org>";
  const cadminBase = (Deno.env.get("CADMIN_BASE_URL") ?? "https://cadmin.kbmcollective.org").replace(/\/+$/, "");
  const redirectTo = (Deno.env.get("APP_PASSWORD_RESET_REDIRECT_URL") ?? `${cadminBase}/auth-recovery.html`)
    .replace(/\/+$/, "");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Server configuration error" }, 500);
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return json({ error: "Valid email is required" }, 400);
  }

  // Always respond success to avoid email enumeration.
  const okResponse = () => json({ ok: true }, 200);

  const admin = createClient(supabaseUrl, serviceRoleKey);

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
      return okResponse();
    }
    return json({ ok: true, via: "supabase_smtp" }, 200);
  }

  const actionLink = linkData.properties.action_link;
  const meta = linkData.user?.user_metadata as { full_name?: string } | undefined;
  const displayName = (meta?.full_name ?? "").trim();
  const greeting = displayName ? `Hi ${displayName},` : "Hi,";

  if (!resendKey) {
    const smtpResult = await sendViaSupabaseSmtp(supabaseUrl, anonKey, email, redirectTo);
    if ("error" in smtpResult) {
      return okResponse();
    }
    return json({ ok: true, via: "supabase_smtp" }, 200);
  }

  const subject = "Reset your KBM Connect password";
  const html = `<p>${greeting}</p>
<p>We received a request to reset the password for <strong>${email}</strong>.</p>
<p>Tap the button below on your phone to open KBM Connect and choose a new password.</p>
<p style="margin:24px 0"><a href="${actionLink}" style="display:inline-block;background:#1e4f8a;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">Reset my password</a></p>
<p style="color:#555;font-size:14px">If the button does not work, copy this link into your phone browser:<br/><a href="${actionLink}">${actionLink}</a></p>
<p style="color:#555;font-size:14px">If you did not request this, you can ignore this email. The link expires after a short time.</p>`;
  const text =
    `${greeting}\n\nWe received a request to reset the password for ${email}.\n\nReset your password using this link:\n${actionLink}\n\nIf you did not request this, ignore this email.`;

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

  if (!res.ok) {
    const detail = await res.text();
    console.error("Resend error", detail);
    const smtpResult = await sendViaSupabaseSmtp(supabaseUrl, anonKey, email, redirectTo);
    if ("error" in smtpResult) {
      return okResponse();
    }
    return json({ ok: true, via: "supabase_smtp_fallback" }, 200);
  }

  return json({ ok: true, via: "resend" }, 200);
});
