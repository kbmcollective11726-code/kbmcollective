import { supabaseAnonKey, supabaseUrl } from './supabase';

/** Request a password reset email for the mobile app (opens auth-recovery.html → app). */
export async function requestAppPasswordReset(email: string): Promise<{ error: string | null }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return { error: 'Email is required.' };
  }
  if (!supabaseUrl || supabaseUrl.includes('placeholder') || !supabaseAnonKey || supabaseAnonKey.includes('placeholder')) {
    return { error: 'App is not configured for password reset.' };
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

    if (!res.ok) {
      let message = `Could not send reset email (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* ignore */
      }
      return { error: message };
    }

    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not send reset email' };
  }
}
