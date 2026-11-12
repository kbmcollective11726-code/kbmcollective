/**
 * Cadmin step-up: email a 6-digit code after password login for platform admins
 * and event admins (same flow / tables).
 *
 * Secrets: RESEND_API_KEY, optional SECURITY_ALERT_FROM_EMAIL / REGISTRATION_FROM_EMAIL
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OTP_TTL_MS = 10 * 60 * 1000;
const STEP_UP_TTL_MS = 6 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

function json(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function resolveFromEmail(): string {
  const candidates = [
    Deno.env.get("SECURITY_ALERT_FROM_EMAIL"),
    Deno.env.get("REGISTRATION_FROM_EMAIL"),
    "KBM Connect <alerts@kbmcollective.org>",
  ];
  for (const c of candidates) {
    const trimmed = c?.trim();
    if (!trimmed) continue;
    if (/^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/.test(trimmed)) return trimmed;
    const named = trimmed.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+\.[^<>\s]+)>$/);
    if (named) return `${named[1].trim()} <${named[2].trim()}>`;
  }
  return "KBM Connect <alerts@kbmcollective.org>";
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

function sessionIdFromAuthHeader(authHeader: string): string | null {
  try {
    const token = authHeader.slice(7);
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof payload.session_id === "string" && payload.session_id.length <= 200
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}

async function sendOtpEmail(to: string, code: string): Promise<boolean> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("RESEND_API_KEY missing");
    return false;
  }
  const fromEmail = resolveFromEmail();
  const subject = "Your KBM Connect admin sign-in code";
  const html = `<p>Your sign-in code is:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
<p style="color:#555;font-size:14px">This code expires in 10 minutes. If you did not try to sign in to cadmin, ignore this email.</p>`;
  const text = `Your KBM Connect admin sign-in code is ${code}. It expires in 10 minutes.`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromEmail, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    console.error("Resend error", await res.text());
    return false;
  }
  return true;
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
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Server configuration error" }, 500, ch);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401, ch);
  }

  let body: { action?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, ch);
  }
  const action = (body.action ?? "").trim().toLowerCase();
  if (action !== "send" && action !== "verify") {
    return json({ error: "action must be send or verify" }, 400, ch);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user?.id) {
    return json({ error: "Unauthorized" }, 401, ch);
  }
  const sessionId = sessionIdFromAuthHeader(authHeader);
  if (!sessionId) {
    return json({ error: "Authenticated session identifier is missing." }, 401, ch);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile } = await admin
    .from("users")
    .select("is_platform_admin, is_active, email")
    .eq("id", user.id)
    .maybeSingle();

  const isPlatformAdmin =
    (profile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;
  const { data: memberRows } = await admin
    .from("event_members")
    .select("role, roles, is_active")
    .eq("user_id", user.id);
  const isEventAdmin = (memberRows ?? []).some((r: {
    role?: string;
    roles?: string[] | null;
    is_active?: boolean | null;
  }) => {
    if (r.is_active === false) return false;
    if (r.role === "admin" || r.role === "super_admin") return true;
    const roles = Array.isArray(r.roles) ? r.roles : [];
    return roles.includes("admin") || roles.includes("super_admin");
  });
  if (!isPlatformAdmin && !isEventAdmin) {
    return json({ error: "Email verification is only for cadmin admins." }, 403, ch);
  }
  if ((profile as { is_active?: boolean } | null)?.is_active === false) {
    return json({ error: "Account is deactivated." }, 403, ch);
  }

  const email =
    (profile as { email?: string } | null)?.email?.trim().toLowerCase() ||
    user.email?.trim().toLowerCase() ||
    "";
  if (!email || !email.includes("@")) {
    return json({ error: "No email on this account." }, 400, ch);
  }

  if (action === "send") {
    const now = Date.now();
    const { data: existing } = await admin
      .from("platform_admin_login_otps")
      .select("sent_at, send_window_started_at, send_count")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .maybeSingle();
    const prior = existing as {
      sent_at?: string;
      send_window_started_at?: string;
      send_count?: number;
    } | null;
    const sentAt = prior?.sent_at ? Date.parse(prior.sent_at) : 0;
    if (Number.isFinite(sentAt) && now - sentAt < RESEND_COOLDOWN_MS) {
      return json({ error: "Wait one minute before requesting another code." }, 429, ch);
    }
    const priorWindow = prior?.send_window_started_at
      ? Date.parse(prior.send_window_started_at)
      : 0;
    const inWindow = Number.isFinite(priorWindow) && now - priorWindow < SEND_WINDOW_MS;
    const sendCount = inWindow ? Number(prior?.send_count ?? 0) : 0;
    if (sendCount >= MAX_SENDS_PER_WINDOW) {
      return json({ error: "Too many codes requested. Try again later." }, 429, ch);
    }

    const code = randomOtp();
    const code_hash = await hmacHex(
      serviceRoleKey,
      `${user.id}:${sessionId}:${code}`,
    );
    const nowIso = new Date(now).toISOString();
    const expires_at = new Date(now + OTP_TTL_MS).toISOString();

    const { error: upsertErr } = await admin.from("platform_admin_login_otps").upsert({
      user_id: user.id,
      session_id: sessionId,
      code_hash,
      expires_at,
      attempts: 0,
      created_at: nowIso,
      sent_at: nowIso,
      send_window_started_at: inWindow
        ? new Date(priorWindow).toISOString()
        : nowIso,
      send_count: sendCount + 1,
    }, { onConflict: "user_id,session_id" });
    if (upsertErr) {
      console.error("otp upsert", upsertErr);
      return json({ error: "Could not create sign-in code." }, 500, ch);
    }

    const emailed = await sendOtpEmail(email, code);
    if (!emailed) {
      await admin
        .from("platform_admin_login_otps")
        .delete()
        .eq("user_id", user.id)
        .eq("session_id", sessionId);
      return json({ error: "Could not send email. Check RESEND_API_KEY." }, 500, ch);
    }

    const masked = email.replace(/(.{2})(.*)(@.*)/, (_m, a, mid, c) =>
      `${a}${"•".repeat(Math.min(mid.length, 6))}${c}`
    );
    return json({ ok: true, emailed: true, email_hint: masked }, 200, ch);
  }

  // verify
  const code = String(body.code ?? "").trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) {
    return json({ error: "Enter the 6-digit code from your email." }, 400, ch);
  }

  const { data: row, error: rowErr } = await admin
    .from("platform_admin_login_otps")
    .select("code_hash, expires_at, attempts")
    .eq("user_id", user.id)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (rowErr || !row) {
    return json({ error: "No code found. Request a new one." }, 400, ch);
  }

  const attempts = Number((row as { attempts?: number }).attempts ?? 0);
  if (attempts >= MAX_ATTEMPTS) {
    return json({ error: "Too many attempts. Request a new code." }, 400, ch);
  }

  const expiresAt = new Date(String((row as { expires_at: string }).expires_at)).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return json({ error: "That code expired. Request a new one." }, 400, ch);
  }

  const expected = String((row as { code_hash: string }).code_hash);
  const actual = await hmacHex(
    serviceRoleKey,
    `${user.id}:${sessionId}:${code}`,
  );
  if (actual !== expected) {
    await admin
      .from("platform_admin_login_otps")
      .update({ attempts: attempts + 1 })
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .eq("attempts", attempts);
    return json({ error: "Incorrect code. Try again." }, 400, ch);
  }

  const verifiedUntil = new Date(Date.now() + STEP_UP_TTL_MS).toISOString();
  const { error: stepUpErr } = await admin
    .from("platform_admin_step_up_sessions")
    .upsert({
      user_id: user.id,
      session_id: sessionId,
      verified_until: verifiedUntil,
      created_at: new Date().toISOString(),
    });
  if (stepUpErr) {
    console.error("step-up upsert", stepUpErr);
    return json({ error: "Could not complete secure admin verification." }, 500, ch);
  }

  await admin
    .from("platform_admin_login_otps")
    .delete()
    .eq("user_id", user.id)
    .eq("session_id", sessionId);
  return json({ ok: true, verified: true, verified_until: verifiedUntil }, 200, ch);
});
