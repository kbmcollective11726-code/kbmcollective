import { supabaseAnonKey, supabaseUrl } from './supabase';
import { captureAppException, Sentry, isSentryEnabled } from './sentry';

const LOCK_FALLBACK = 'Too many sign-in attempts from this network. Try again later.';
const UNAVAILABLE =
  'Sign-in protection is temporarily unavailable. Please try again in a moment.';

/** Throttle outage alerts so a door rush does not flood Sentry. */
let lastOutageAlertAt = 0;
const OUTAGE_ALERT_COOLDOWN_MS = 60_000;

function alertLimiterOutage(
  reason: string,
  extra?: Record<string, unknown>,
  level: 'error' | 'warning' = 'error',
): void {
  const now = Date.now();
  if (now - lastOutageAlertAt < OUTAGE_ALERT_COOLDOWN_MS) return;
  lastOutageAlertAt = now;
  if (__DEV__) {
    console.warn('[loginRateLimit]', level, reason, extra ?? '');
  }
  if (!isSentryEnabled()) return;
  Sentry.captureMessage(`login-rate-limit unavailable (${level}): ${reason}`, {
    level,
    tags: { area: 'login_rate_limit', fail_closed: level === 'error' ? 'true' : 'soft_open' },
    extra: { reason, ...extra },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeEmail(value: string): boolean {
  return value.includes('@') && value.indexOf('@') < value.length - 1;
}

async function fetchLoginRateLimitOnce(body: {
  action: 'check' | 'record';
  email: string;
  success?: boolean;
  source?: string;
  accessToken?: string;
}): Promise<Response> {
  const bearer =
    body.action === 'record' && body.success === true && body.accessToken
      ? body.accessToken
      : supabaseAnonKey;
  const payload: Record<string, unknown> = {
    action: body.action,
    email: body.email,
  };
  if (typeof body.success === 'boolean') payload.success = body.success;
  if (body.source) payload.source = body.source;

  return fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/login-rate-limit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(payload),
  });
}

async function invokeLoginRateLimit(body: {
  action: 'check' | 'record';
  email: string;
  success?: boolean;
  source?: string;
  accessToken?: string;
}): Promise<{ allowed: boolean; message?: string; unavailable?: boolean }> {
  if (!supabaseUrl || supabaseUrl.includes('placeholder') || !supabaseAnonKey) {
    alertLimiterOutage('missing_supabase_config', { action: body.action });
    return { allowed: false, message: UNAVAILABLE, unavailable: true };
  }
  try {
    let res = await fetchLoginRateLimitOnce(body);
    // One quick retry for Edge cold-start / gateway timeouts.
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      await sleep(450);
      res = await fetchLoginRateLimitOnce(body);
    }

    const rawText = await res.text();
    let json: { allowed?: boolean; message?: string; error?: string } = {};
    try {
      json = rawText ? (JSON.parse(rawText) as typeof json) : {};
    } catch {
      json = {};
    }

    if (!res.ok) {
      const detail =
        (typeof json.error === 'string' && json.error) ||
        (typeof json.message === 'string' && json.message) ||
        rawText.slice(0, 180);
      // Check path: soft-open so a bad/transient limiter response never blocks sign-in
      // (REACT-NATIVE-J: http_400 was fail-closing real users). Lockouts return HTTP 200.
      if (body.action === 'check') {
        alertLimiterOutage(
          `http_${res.status}`,
          { action: body.action, status: res.status, detail },
          'warning'
        );
        return { allowed: true };
      }
      alertLimiterOutage(`http_${res.status}`, {
        action: body.action,
        status: res.status,
        detail,
      });
      return { allowed: false, message: UNAVAILABLE, unavailable: true };
    }
    return {
      allowed: json.allowed !== false,
      message: typeof json.message === 'string' ? json.message : undefined,
    };
  } catch (err) {
    if (body.action === 'check') {
      alertLimiterOutage('network_error', { action: body.action }, 'warning');
      // Soft-open only — do not captureAppException (that filed REACT-NATIVE-M as TypeError).
      return { allowed: true };
    }
    alertLimiterOutage('network_error', { action: body.action });
    captureAppException(err, { area: 'login_rate_limit', action: body.action });
    return { allowed: false, message: UNAVAILABLE, unavailable: true };
  }
}

/**
 * Returns an error message if this email/IP is locked out.
 * Soft-opens on check when the limiter is unreachable or returns unexpected HTTP errors.
 * Real lockouts are HTTP 200 with allowed:false.
 */
export async function getLoginRateLimitError(email: string): Promise<string | null> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !looksLikeEmail(trimmed)) return null;
  const result = await invokeLoginRateLimit({ action: 'check', email: trimmed });
  if (result.allowed) return null;
  return result.message || (result.unavailable ? UNAVAILABLE : LOCK_FALLBACK);
}

export function recordLoginRateLimitAttempt(params: {
  email: string;
  success: boolean;
  source: string;
  /** Required when success is true (user access token). */
  accessToken?: string;
}): void {
  const email = params.email.trim().toLowerCase();
  if (!email || !looksLikeEmail(email)) return;
  if (params.success && !params.accessToken) return;
  void invokeLoginRateLimit({
    action: 'record',
    email,
    success: params.success,
    source: params.source,
    accessToken: params.accessToken,
  });
}
