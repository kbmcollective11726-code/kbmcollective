import { supabase } from './supabase';

/** True if the user is an active event admin / super_admin on any event. */
export function rowHasEventAdminRole(row: {
  role?: string | null;
  roles?: string[] | null;
  is_active?: boolean | null;
}): boolean {
  if (row.is_active === false) return false;
  if (row.role === 'admin' || row.role === 'super_admin') return true;
  const roles = Array.isArray(row.roles) ? row.roles : [];
  return roles.includes('admin') || roles.includes('super_admin');
}

/** Platform admin or event admin — anyone who may use cadmin after email OTP. */
export async function userNeedsCadminEmailOtp(userId: string): Promise<{
  needsOtp: boolean;
  isPlatformAdmin: boolean;
  hasEventAdminRole: boolean;
  error?: string;
}> {
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    return {
      needsOtp: true,
      isPlatformAdmin: false,
      hasEventAdminRole: false,
      error: profileError.message,
    };
  }

  const isPlatformAdmin =
    (profile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;

  const { data: memberRows, error: memberError } = await supabase
    .from('event_members')
    .select('role, roles, is_active')
    .eq('user_id', userId);

  if (memberError) {
    return {
      needsOtp: true,
      isPlatformAdmin,
      hasEventAdminRole: false,
      error: memberError.message,
    };
  }

  const hasEventAdminRole = (memberRows ?? []).some((r) =>
    rowHasEventAdminRole(r as { role?: string; roles?: string[] | null; is_active?: boolean | null }),
  );

  return {
    needsOtp: isPlatformAdmin || hasEventAdminRole,
    isPlatformAdmin,
    hasEventAdminRole,
  };
}
