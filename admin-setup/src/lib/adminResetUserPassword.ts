import { supabase, supabaseUrl, edgeFunctionHeaders } from './supabase';
import { refreshSupabaseSessionIfNeeded } from './refreshSupabaseSession';

async function getEdgeFunctionAccessToken(): Promise<string | null> {
  const { data: refreshed } = await supabase.auth.refreshSession();
  if (refreshed.session?.access_token) return refreshed.session.access_token;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Set Auth password and/or Auth email via Edge Function (service role). No user-facing email for reset.
 * Pass `eventId` when the caller is an event admin (members page); omit for platform admins (all users).
 * Use `newEmail` when the admin changed email in `public.users` so `auth.users.email` stays in sync (required for app login).
 */
export async function adminResetUserPassword(params: {
  userId: string;
  newPassword?: string;
  newEmail?: string;
  eventId?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const pw = params.newPassword?.trim() ?? '';
  const em = params.newEmail?.trim().toLowerCase() ?? '';
  if (!pw && !em) {
    return { ok: false, message: 'Provide a new password and/or email to sync.' };
  }
  if (pw && pw.length < 8) {
    return { ok: false, message: 'Password must be at least 8 characters.' };
  }

  await refreshSupabaseSessionIfNeeded();
  const token = await getEdgeFunctionAccessToken();
  if (!token || !supabaseUrl) {
    return { ok: false, message: 'You must be signed in.' };
  }
  const body: Record<string, string> = {
    user_id: params.userId,
  };
  if (pw) body.new_password = pw;
  if (em) body.new_email = em;
  if (params.eventId) {
    body.event_id = params.eventId;
  }
  const res = await fetch(`${supabaseUrl}/functions/v1/admin-reset-user-password`, {
    method: 'POST',
    headers: edgeFunctionHeaders(token),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const msg =
      data.error ||
      (res.status === 401
        ? 'Unauthorized. Sign out and sign in again, then retry.'
        : res.status === 403
          ? 'You do not have permission to reset this password.'
          : `Request failed (${res.status})`);
    return { ok: false, message: msg };
  }
  return { ok: true };
}
