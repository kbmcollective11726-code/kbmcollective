import { supabase } from './supabase';

/** Shown on mobile / portal when is_active = false after a successful password check. */
export const ACCOUNT_DEACTIVATED_MESSAGE =
  'This account has been deactivated. Contact your event organizer if you need access.';

/**
 * Returns an error message if the account is deactivated (and signs out).
 * Uses a SECURITY DEFINER RPC so the check still works after restrictive RLS
 * has blocked the deactivated session from reading its profile row.
 */
export async function rejectIfAccountDeactivated(userId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('is_account_active', { p_user_id: userId });
  if (!error && data === false) {
    await supabase.auth.signOut();
    return ACCOUNT_DEACTIVATED_MESSAGE;
  }
  return null;
}

export function isAccountActive(isActive: boolean | null | undefined): boolean {
  return isActive !== false;
}
