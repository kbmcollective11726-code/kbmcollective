import { supabaseAnonKey, supabaseUrl } from './supabase';

export type PasswordResetOutcome = 'sent' | 'rate_limited' | 'delivery_failed' | 'unknown';

export interface PasswordResetResult {
  error: string | null;
  outcome: PasswordResetOutcome;
}

type ResetApiBody = {
  ok?: boolean;
  error?: string;
  skipped?: 'rate_limited' | 'blocked' | 'delivery_failed';
  via?: string;
};

/** Request a password reset email for the mobile app (opens auth-recovery.html → app). */
export async function requestAppPasswordReset(email: string): Promise<PasswordResetResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return { error: 'Email is required.', outcome: 'unknown' };
  }
  if (!supabaseUrl || supabaseUrl.includes('placeholder') || !supabaseAnonKey || supabaseAnonKey.includes('placeholder')) {
    return { error: 'App is not configured for password reset.', outcome: 'unknown' };
  }

  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/send-app-password-reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ email: trimmed }),
    });

    let body: ResetApiBody | null = null;
    try {
      body = (await res.json()) as ResetApiBody;
    } catch {
      body = null;
    }

    if (!res.ok) {
      const message = body?.error ?? `Could not send reset email (${res.status})`;
      return { error: message, outcome: 'unknown' };
    }

    if (body?.skipped === 'rate_limited') {
      return {
        error: null,
        outcome: 'rate_limited',
      };
    }

    if (body?.skipped === 'delivery_failed') {
      return {
        error: 'We could not send the reset email right now. Try again in a few minutes.',
        outcome: 'delivery_failed',
      };
    }

    if (body?.via === 'resend' || body?.via === 'supabase_smtp' || body?.via === 'supabase_smtp_fallback') {
      return { error: null, outcome: 'sent' };
    }

    // No account, blocked, or silent no-op — same generic UX (no enumeration).
    return { error: null, outcome: 'unknown' };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'Could not send reset email',
      outcome: 'unknown',
    };
  }
}
