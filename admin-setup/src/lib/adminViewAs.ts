import { supabase } from './supabase';
import { isCurrentUserPlatformAdmin } from './fetchAdminEvents';
import { rowHasEventAdminRole } from './cadminAdminAccess';
import type { EventRegistrationSubmission } from './types';

export type PortalViewAsRole = 'delegate' | 'vendor';

export type AdminViewAsState = {
  eventId: string;
  submissionId: string;
  role: PortalViewAsRole;
  displayName: string;
};

const STORAGE_KEY = 'kbm_admin_view_as';

export function portalRoleFromAttendeeType(
  attendeeType: string | null | undefined,
): PortalViewAsRole | null {
  const t = (attendeeType ?? '').toLowerCase();
  if (t === 'vendor' || t === 'sponsor') return 'vendor';
  if (t === 'attendee' || t === 'delegate') return 'delegate';
  return null;
}

export function portalRoleFromMemberRoles(
  role: string | null | undefined,
  roles: string[] | null | undefined,
): PortalViewAsRole | null {
  const all = [role, ...(roles ?? [])].map((r) => (r ?? '').toLowerCase());
  if (all.includes('vendor')) return 'vendor';
  if (all.includes('attendee') || all.includes('delegate')) return 'delegate';
  return null;
}

export function displayNameFromSubmission(sub: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  company_name?: string | null;
}): string {
  const name = [sub.first_name, sub.last_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (sub.email) return sub.email;
  if (sub.company_name) return sub.company_name;
  return 'Member';
}

export function readAdminViewAs(): AdminViewAsState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminViewAsState;
    if (
      !parsed?.eventId ||
      !parsed?.submissionId ||
      (parsed.role !== 'delegate' && parsed.role !== 'vendor')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeAdminViewAs(state: AdminViewAsState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearAdminViewAs(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function resolveAdminViewAs(
  eventId: string,
  role: PortalViewAsRole,
  search: string,
): AdminViewAsState | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const fromQuery = params.get('viewAs')?.trim() || '';
  const stored = readAdminViewAs();
  if (fromQuery) {
    const displayName =
      stored?.eventId === eventId && stored.submissionId === fromQuery
        ? stored.displayName
        : 'Member';
    return { eventId, submissionId: fromQuery, role, displayName };
  }
  if (stored && stored.eventId === eventId && stored.role === role) return stored;
  return null;
}

export async function currentUserCanAdminViewAs(eventId: string): Promise<boolean> {
  if (await isCurrentUserPlatformAdmin()) return true;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return false;
  const { data, error } = await supabase
    .from('event_members')
    .select('role, roles, is_active')
    .eq('event_id', eventId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error || !data) return false;
  return rowHasEventAdminRole(
    data as { role?: string | null; roles?: string[] | null; is_active?: boolean | null },
  );
}

export async function loadSubmissionForAdminViewAs(
  eventId: string,
  submissionId: string,
  role: PortalViewAsRole,
): Promise<EventRegistrationSubmission | null> {
  const expectedType = role === 'vendor' ? 'vendor' : 'attendee';
  const { data, error } = await supabase
    .from('event_registration_submissions')
    .select('*')
    .eq('id', submissionId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as EventRegistrationSubmission;
  if (row.attendee_type === expectedType) return row;
  if (role === 'delegate' && row.attendee_type === 'attendee') return row;
  if (role === 'vendor' && row.attendee_type === 'vendor') return row;
  return null;
}

export async function findSubmissionForMemberViewAs(
  eventId: string,
  userId: string,
  role: PortalViewAsRole,
): Promise<EventRegistrationSubmission | null> {
  const expectedType = role === 'vendor' ? 'vendor' : 'attendee';
  const { data, error } = await supabase
    .from('event_registration_submissions')
    .select('*')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .eq('attendee_type', expectedType)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as EventRegistrationSubmission | null) ?? null;
}

/** Stay signed in as admin; open member portal on the same origin (no magic link). */
export function openAdminViewAsPortal(
  state: AdminViewAsState,
  page: 'welcome' | 'registration' = 'welcome',
): void {
  writeAdminViewAs(state);
  const pathPage = page === 'registration' ? 'registration' : 'welcome';
  const url = `/portal/${state.eventId}/${state.role}/${pathPage}?viewAs=${encodeURIComponent(state.submissionId)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
