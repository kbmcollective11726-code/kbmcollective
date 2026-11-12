import { supabase, supabaseUrl, supabaseAnonKey } from './supabase';

const OTP_EVENT = 'cadmin-platform-email-otp';

export function clearPlatformAdminEmailOtp(): void {
  // Verification is bound to the server-side Auth session. Signing out
  // invalidates that session; there is no browser authorization flag to clear.
}

function notifyPlatformAdminEmailOtpVerified(): void {
  try {
    window.dispatchEvent(new Event(OTP_EVENT));
  } catch {
    /* ignore */
  }
}

/** Subscribe to successful email OTP verification (same tab). */
export function onPlatformAdminEmailOtpVerified(handler: () => void): () => void {
  const fn = () => handler();
  window.addEventListener(OTP_EVENT, fn);
  return () => window.removeEventListener(OTP_EVENT, fn);
}

/** Server-authoritative check for this exact authenticated session. */
export async function hasPlatformAdminEmailOtp(userId: string): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id || session.user.id !== userId) return false;
  const { data, error } = await supabase.rpc('has_platform_admin_step_up', {
    p_user_id: userId,
  });
  if (error) return false;
  return data === true;
}

async function invokeOtp(body: { action: 'send' | 'verify'; code?: string }) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    throw new Error('Not signed in.');
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/platform-admin-email-otp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(body),
  });

  let json: {
    ok?: boolean;
    error?: string;
    email_hint?: string;
    verified?: boolean;
    verified_until?: string;
  } = {};
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}

export async function sendPlatformAdminEmailOtp() {
  return invokeOtp({ action: 'send' });
}

export async function verifyPlatformAdminEmailOtp(code: string) {
  const result = await invokeOtp({ action: 'verify', code });
  notifyPlatformAdminEmailOtpVerified();
  return result;
}
