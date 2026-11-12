import { supabaseUrl } from './supabase';

export type AuthAttemptSource = 'mobile' | 'cadmin';

/** Fire-and-forget login audit (does not block sign-in UI). */
export function logAuthAttempt(params: {
  email: string;
  success: boolean;
  source: AuthAttemptSource;
  errorMessage?: string;
  userId?: string;
  anonKey: string;
  /** Required for success logs (user access token). */
  accessToken?: string;
}): void {
  const email = params.email.trim().toLowerCase();
  if (!email || !supabaseUrl || !params.anonKey) return;
  if (params.success && !params.accessToken) return;

  const bearer =
    params.success && params.accessToken
      ? params.accessToken
      : params.anonKey;

  void fetch(`${supabaseUrl}/functions/v1/log-auth-attempt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      apikey: params.anonKey,
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
