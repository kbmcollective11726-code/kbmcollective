import { supabase } from './supabase';
import type { Event } from './types';

const EVENT_SELECT =
  'id, name, description, location, venue, start_date, end_date, theme_color, event_code, is_active, created_at';

/** Events the signed-in user can open in admin (platform admin: all; else admin/super_admin memberships). */
export async function fetchEventsForAdminUser(): Promise<Event[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];

  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();

  const isPlatformAdmin = (profile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;

  if (isPlatformAdmin) {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_SELECT)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as Event[]) ?? [];
  }

  const { data: memberRows } = await supabase
    .from('event_members')
    .select('event_id, role, roles')
    .eq('user_id', user.id);

  const isRowEventAdmin = (r: { role?: string; roles?: string[] | null }) =>
    r.role === 'admin' ||
    r.role === 'super_admin' ||
    (Array.isArray(r.roles) && (r.roles.includes('admin') || r.roles.includes('super_admin')));

  const ids = [
    ...new Set(
      (memberRows ?? [])
        .filter((r: { event_id: string; role?: string; roles?: string[] | null }) => isRowEventAdmin(r))
        .map((r: { event_id: string }) => r.event_id)
    ),
  ];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('events')
    .select(EVENT_SELECT)
    .in('id', ids)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Event[]) ?? [];
}

/**
 * Events shown in the header switcher: all events for platform admins, otherwise any event
 * the user is a member of (admin, attendee, etc.) so “Join with code” appears in the list.
 */
export async function fetchEventsForSwitcher(): Promise<Event[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];

  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();

  const isPlatformAdmin = (profile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;

  if (isPlatformAdmin) {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_SELECT)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as Event[]) ?? [];
  }

  const { data: memberRows } = await supabase
    .from('event_members')
    .select('event_id')
    .eq('user_id', user.id);

  const ids = [...new Set((memberRows ?? []).map((r: { event_id: string }) => r.event_id))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('events')
    .select(EVENT_SELECT)
    .in('id', ids)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Event[]) ?? [];
}

/** True when the signed-in user has users.is_platform_admin (KBM platform operator). */
export async function isCurrentUserPlatformAdmin(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return false;
  const { data: profile } = await supabase
    .from('users')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();
  return (profile as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;
}
