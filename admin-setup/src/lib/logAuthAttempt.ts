import { supabaseUrl, supabaseAnonKey } from './supabase';

export type AuthAttemptSource = 'mobile' | 'cadmin' | 'portal';

/** Fire-and-forget login audit (does not block sign-in UI). */
export function logAuthAttempt(params: {
  email: string;
  success: boolean;
  source: AuthAttemptSource;
  errorMessage?: string;
  userId?: string;
  anonKey?: string;
  /** Required for success logs (user access token). */
  accessToken?: string;
}): void {
  const email = params.email.trim().toLowerCase();
  const anonKey = (params.anonKey || supabaseAnonKey).trim();
  if (!email || !supabaseUrl || !anonKey) return;
  if (params.success && !params.accessToken) return;

  const bearer =
    params.success && params.accessToken
      ? params.accessToken
      : anonKey;

  void fetch(`${supabaseUrl}/functions/v1/log-auth-attempt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      email,
      success: params.success,
      source: params.source,
      error_message: params.errorMessage ?? undefined,
      user_id: params.userId ?? undefined,
    }),
  }).catch(() => {
    /* non-blocking */
  });
}
