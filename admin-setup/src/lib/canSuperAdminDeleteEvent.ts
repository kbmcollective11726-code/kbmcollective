import { supabase } from './supabase';

/**
 * Who may delete an entire event (matches RLS on `events` DELETE after migration):
 * - Platform admin (`users.is_platform_admin`), or
 * - Event member with `super_admin` as primary `role` or in `roles[]`.
 */
export async function canSuperAdminDeleteEvent(eventId: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return false;

  const { data: profile } = await supabase.from('users').select('is_platform_admin').eq('id', user.id).maybeSingle();
  if ((profile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true) return true;

  const { data: em } = await supabase
    .from('event_members')
    .select('role, roles')
    .eq('event_id', eventId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!em) return false;
  if (em.role === 'super_admin') return true;
  const roles = Array.isArray(em.roles) ? em.roles : [];
  return roles.includes('super_admin');
}
