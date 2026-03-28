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
    .select('event_id')
    .eq('user_id', user.id)
    .in('role', ['admin', 'super_admin']);

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
