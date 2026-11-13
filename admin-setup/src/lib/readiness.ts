import { supabase, supabaseUrl, edgeFunctionHeaders } from './supabase';
import { refreshSupabaseSessionIfNeeded } from './refreshSupabaseSession';
import { postgrestErrorMessage } from './postgrestErrorMessage';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info' | 'not_set_up';

export interface ReadinessCheck {
  id: string;
  group: string;
  label: string;
  status: CheckStatus;
  detail: string;
  items?: string[];
}

export interface ReadinessCounts {
  ok: number;
  warn: number;
  fail: number;
  info: number;
}

export interface EventReadiness {
  event: {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    timezone: string;
    timezone_set: boolean;
    phase: 'upcoming' | 'live' | 'ended';
    phase_label: string;
    now_local: string;
  };
  overall: 'ok' | 'warn' | 'fail';
  counts: ReadinessCounts;
  checks: ReadinessCheck[];
  generated_at: string;
}

export interface HealthJob {
  name: string;
  schedule: string;
  active: boolean;
  last_run: string | null;
  last_status: string | null;
  runs_24h: number;
  failed_24h: number;
  last_error: string | null;
}

export interface HealthEventIssue {
  status: 'fail' | 'warn';
  label: string;
  detail: string;
  items: string[] | null;
}

export interface HealthEventSummary {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  overall: 'ok' | 'warn' | 'fail';
  counts: ReadinessCounts;
  phase_label: string;
  issues?: HealthEventIssue[];
}

export interface PeakMoment {
  event: string;
  when: string;
  pushes: number;
  meetings?: number;
  sessions?: number;
}

export interface PlatformHealthSnapshot {
  generated_at: string;
  jobs: HealthJob[];
  server_calls: { total_24h: number; failed_24h: number };
  database: { size: string; connections: number; active_connections?: number; max_connections: number };
  load?: { peak_meetings: PeakMoment | null; peak_sessions: PeakMoment | null };
  activity: { notifications_24h: number; posts_24h: number; sign_ins_24h: number };
  events: HealthEventSummary[];
}

export interface OutsideCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  ms?: number;
}

export interface SentryIssue {
  short_id: string;
  title: string;
  count: number;
  users: number;
  first_seen: string;
  last_seen: string;
  url: string;
  is_new: boolean;
}

export interface OutsideChecks {
  generated_at: string;
  checks: OutsideCheck[];
  sentry_issues: SentryIssue[];
}

type RpcError = { error: string };

function rpcErrorMessage(code: string): string {
  if (code === 'forbidden') return 'You do not have access to this check.';
  if (code === 'not_authenticated') return 'Your session expired. Sign out and sign in again.';
  if (code === 'not_found') return 'Event not found.';
  return code;
}

export async function fetchEventReadiness(eventId: string): Promise<EventReadiness> {
  await refreshSupabaseSessionIfNeeded();
  const { data, error } = await supabase.rpc('admin_event_readiness', { p_event_id: eventId });
  if (error) throw new Error(postgrestErrorMessage(error));
  const row = data as EventReadiness | RpcError | null;
  if (!row) throw new Error('No readiness data returned.');
  if ('error' in row) throw new Error(rpcErrorMessage(row.error));
  return row;
}

export async function fetchPlatformHealthSnapshot(): Promise<PlatformHealthSnapshot> {
  await refreshSupabaseSessionIfNeeded();
  const { data, error } = await supabase.rpc('platform_health_snapshot');
  if (error) throw new Error(postgrestErrorMessage(error));
  const row = data as PlatformHealthSnapshot | RpcError | null;
  if (!row) throw new Error('No health data returned.');
  if ('error' in row) throw new Error(rpcErrorMessage(row.error));
  return row;
}

export async function fetchOutsideChecks(): Promise<OutsideChecks> {
  await refreshSupabaseSessionIfNeeded();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token || !supabaseUrl) throw new Error('You must be signed in.');
  const res = await fetch(`${supabaseUrl}/functions/v1/platform-health`, {
    method: 'POST',
    headers: edgeFunctionHeaders(token),
    body: '{}',
  });
  const body = (await res.json().catch(() => ({}))) as OutsideChecks | { error?: string };
  if (!res.ok) {
    const msg = 'error' in body && body.error ? body.error : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as OutsideChecks;
}

export function worstStatus(statuses: CheckStatus[]): 'ok' | 'warn' | 'fail' {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'ok';
}

export const OVERALL_LABEL: Record<'ok' | 'warn' | 'fail', string> = {
  ok: 'Ready',
  warn: 'Needs attention',
  fail: 'Problems found',
};
