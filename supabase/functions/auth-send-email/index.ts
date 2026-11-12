// Auth "Send Email" hook — replaces built-in Auth mailer when enabled in Dashboard.
// Blocks recovery/reset emails when public.users.password_reset_blocked = true
// (same toggle as cadmin Platform users). Other auth emails go out via Resend.
//
// Setup (required — hook does nothing until enabled):
// 1. Deploy this function (verify_jwt = false).
// 2. Dashboard → Authentication → Hooks → Send Email → HTTPS
//    URL: https://<project>.supabase.co/functions/v1/auth-send-email
// 3. Generate secret → Edge Function secret SEND_EMAIL_HOOK_SECRET
//    (paste the full value, including v1,whsec_ if shown).
// 4. Save/enable the hook.
//
// Secrets: SEND_EMAIL_HOOK_SECRET, RESEND_API_KEY,
// optional AUTH_EMAIL_FROM / REGISTRATION_FROM_EMAIL / SECURITY_ALERT_FROM_EMAIL
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type EmailActionType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "reset_password"
  | "email_change"
  | "email_change_current"
  | "email_change_new"
  | "reauthentication"
  | string;

type HookPayload = {
  user: {
    id: string;
    email?: string;
    new_email?: string;
    user_metadata?: { full_name?: string };
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: EmailActionType;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRecoveryAction(action: string): boolean {
  const a = action.toLowerCase();
  return a === "recovery" || a === "reset_password";
}

function buildVerifyUrl(
  supabaseUrl: string,
  tokenHash: string,
  type: string,
  redirectTo: string,
): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    token: tokenHash,
    type,
    redirect_to: redirectTo || "",
  });
  return `${base}/auth/v1/verify?${params.toString()}`;
}

function subjectFor(action: EmailActionType): string {
  switch (action) {
    case "signup":
      return "Confirm your KBM Connect email";
    case "invite":
      return "You're invited to KBM Connect";
    case "magiclink":
      return "Your KBM Connect sign-in link";
    case "recovery":
    case "reset_password":
      return "Reset your KBM Connect password";
    case "email_change":
    case "email_change_current":
    case "email_change_new":
      return "Confirm your email change";
    case "reauthentication":
      return "Confirm it's you — KBM Connect";
    default:
      return "KBM Connect account email";
  }
}

function bodyFor(
  action: EmailActionType,
  greeting: string,
  email: string,
  actionLink: string,
  otp: string,
): { html: string; text: string } {
  if (isRecoveryAction(action)) {
    const html =
      `<p>${greeting}</p>` +
      `<p>We received a request to reset the password for <strong>${email}</strong>.</p>` +
      `<p>Tap the button below to choose a new password.</p>` +
      `<p style="margin:24px 0"><a href="${actionLink}" style="display:inline-block;background:#1e4f8a;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">Reset my password</a></p>` +
      `<p style="color:#555;font-size:14px">If you did not request this, you can ignore this email.</p>`;
    const text =
      `${greeting}\n\nReset your password for ${email}:\n${actionLink}\n\nIf you did not request this, ignore this email.`;
    return { html, text };
  }

  const codeLine = otp
    ? `<p>Your code: <strong style="font-size:18px;letter-spacing:2px">${otp}</strong></p>`
    : "";
  const html =
    `<p>${greeting}</p>` +
    `<p>Use the link or code below to continue with your KBM Connect account (${email}).</p>` +
    codeLine +
    (actionLink
      ? `<p style="margin:24px 0"><a href="${actionLink}" style="display:inline-block;background:#1e4f8a;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:600">Continue</a></p>`
      : "") +
    `<p style="color:#555;font-size:14px">If you did not expect this email, you can ignore it.</p>`;
  const text =
    `${greeting}\n\nContinue for ${email}` +
    (otp ? `\nCode: ${otp}` : "") +
    (actionLink ? `\n${actionLink}` : "") +
    `\n\nIf you did not expect this, ignore this email.`;
  return { html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("not allowed", { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const hookSecretRaw = Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "";
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromEmail =
    Deno.env.get("AUTH_EMAIL_FROM") ??
    Deno.env.get("REGISTRATION_FROM_EMAIL") ??
    Deno.env.get("SECURITY_ALERT_FROM_EMAIL") ??
    "KBM Connect <info@kbmcollective.org>";

  if (!supabaseUrl || !serviceRoleKey || !hookSecretRaw) {
    console.error("auth-send-email misconfigured (url/service/hook secret)");
    return json({ error: { message: "Hook misconfigured" } }, 500);
  }
  if (!resendKey) {
    console.error("auth-send-email missing RESEND_API_KEY");
    return json({ error: { message: "Email provider not configured" } }, 500);
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  // Dashboard secret is often "v1,whsec_…"; standardwebhooks wants the base64 part.
  const hookSecret = hookSecretRaw.replace(/^v1,whsec_/, "").replace(/^v1,/, "");
  let data: HookPayload;
  try {
    const wh = new Webhook(hookSecret);
    data = wh.verify(payload, headers) as HookPayload;
  } catch (e) {
    console.error("auth-send-email verify failed", e);
    return json({ error: { http_code: 401, message: "Invalid signature" } }, 401);
  }

  const user = data.user;
  const emailData = data.email_data;
  const action = (emailData?.email_action_type || "").toLowerCase();
  const email = (user?.email || "").trim().toLowerCase();
  if (!email) {
    return json({});
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  if (isRecoveryAction(action)) {
    // Prefer Auth user id; fall back to email for edge cases.
    let blocked = false;
    let blockedUserId: string | undefined;
    if (user?.id) {
      const { data: byId } = await admin
        .from("users")
        .select("id, password_reset_blocked")
        .eq("id", user.id)
        .maybeSingle();
      if ((byId as { password_reset_blocked?: boolean } | null)?.password_reset_blocked === true) {
        blocked = true;
        blockedUserId = (byId as { id?: string }).id;
      }
    }
    if (!blocked) {
      const { data: byEmail } = await admin
        .from("users")
        .select("id, password_reset_blocked")
        .eq("email", email)
        .maybeSingle();
      if ((byEmail as { password_reset_blocked?: boolean } | null)?.password_reset_blocked === true) {
        blocked = true;
        blockedUserId = (byEmail as { id?: string }).id;
      }
    }
    if (blocked) {
      console.log("auth-send-email suppressed recovery for blocked user", blockedUserId);
      // 200 + empty = Auth treats as sent; no email goes out (anti-enumeration).
      return json({});
    }
  }

  const verifyType = action === "reset_password" ? "recovery" : action;
  const actionLink = emailData.token_hash
    ? buildVerifyUrl(supabaseUrl, emailData.token_hash, verifyType, emailData.redirect_to || "")
    : "";
  const greetingName = (user.user_metadata?.full_name ?? "").trim();
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi,";
  const { html, text } = bodyFor(action, greeting, email, actionLink, emailData.token || "");
  const subject = subjectFor(action);

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
    console.error("auth-send-email Resend error", res.status, detail);
    return json(
      { error: { http_code: 500, message: "Failed to send email" } },
      500,
    );
  }

  return json({});
});
