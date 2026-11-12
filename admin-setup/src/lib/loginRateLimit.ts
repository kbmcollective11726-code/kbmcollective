import { supabaseAnonKey, supabaseUrl } from './supabase';

const LOCK_FALLBACK = 'Too many sign-in attempts from this network. Try again later.';
const UNAVAILABLE =
  'Sign-in protection is temporarily unavailable. Please try again in a moment.';

let lastOutageAlertAt = 0;
const OUTAGE_ALERT_COOLDOWN_MS = 60_000;

function alertLimiterOutage(reason: string, extra?: Record<string, unknown>): void {
  const now = Date.now();
  if (now - lastOutageAlertAt < OUTAGE_ALERT_COOLDOWN_MS) return;
  lastOutageAlertAt = now;
  console.error('[loginRateLimit] fail-closed — limiter unavailable:', reason, extra ?? '');
}

async function invokeLoginRateLimit(body: {
  action: 'check' | 'record';
  email: string;
  success?: boolean;
  source?: string;
  accessToken?: string;
}): Promise<{ allowed: boolean; message?: string; unavailable?: boolean }> {
  if (!supabaseUrl || !supabaseAnonKey) {
    alertLimiterOutage('missing_supabase_config', { action: body.action });
    return { allowed: false, message: UNAVAILABLE, unavailable: true };
  }
  try {
    const bearer =
      body.action === 'record' && body.success === true && body.accessToken
        ? body.accessToken
        : supabaseAnonKey;
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/login-rate-limit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        action: body.action,
        email: body.email,
        success: body.success,
        source: body.source,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      allowed?: boolean;
      message?: string;
    };
    if (!res.ok) {
      alertLimiterOutage(`http_${res.status}`, { action: body.action, status: res.status });
      return { allowed: false, message: UNAVAILABLE, unavailable: true };
    }
    return {
      allowed: json.allowed !== false,
      message: typeof json.message === 'string' ? json.message : undefined,
    };
  } catch (err) {
    alertLimiterOutage('network_error', {
      action: body.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: false, message: UNAVAILABLE, unavailable: true };
  }
}

/**
 * Returns an error message if this email/IP is locked out.
 * cadmin fails closed if the limiter Edge Function is unavailable.
 */
export async function getLoginRateLimitError(email: string): Promise<string | null> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  const result = await invokeLoginRateLimit({ action: 'check', email: trimmed });
  if (result.allowed) return null;
  return result.message || (result.unavailable ? UNAVAILABLE : LOCK_FALLBACK);
}

export function recordLoginRateLimitAttempt(params: {
  email: string;
  success: boolean;
  source: string;
  accessToken?: string;
}): void {
  const email = params.email.trim().toLowerCase();
  if (!email) return;
  if (params.success && !params.accessToken) return;
  void invokeLoginRateLimit({
    action: 'record',
    email,
    success: params.success,
    source: params.source,
    accessToken: params.accessToken,
  });
}
