import { supabase } from './supabase';

type PauseRow = {
  notifications_paused?: boolean;
  notifications_paused_until?: string | null;
  updated_at?: string | null;
};

export type NotifPauseDuration = '2' | '6' | '24' | 'indefinite';

const PAUSE_HOUR_BUCKETS = [2, 6, 24] as const;

/** Map saved pause fields to the Auto-unmute dropdown (default 2h when not paused). */
export function notifPauseDurationFromEvent(row: PauseRow | null | undefined): NotifPauseDuration {
  if (row?.notifications_paused !== true) return '2';
  if (!row.notifications_paused_until) return 'indefinite';

  const untilMs = Date.parse(row.notifications_paused_until);
  if (!Number.isFinite(untilMs)) return '2';

  const startMs = row.updated_at ? Date.parse(row.updated_at) : NaN;
  const durationH = Number.isFinite(startMs)
    ? (untilMs - startMs) / (60 * 60 * 1000)
    : (untilMs - Date.now()) / (60 * 60 * 1000);

  let best: NotifPauseDuration = '2';
  let bestDiff = Infinity;
  for (const h of PAUSE_HOUR_BUCKETS) {
    const diff = Math.abs(durationH - h);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = String(h) as NotifPauseDuration;
    }
  }
  return best;
}

/** True when event notifications are paused and auto-unmute has not expired. */
export function isEventNotificationsPausedActive(row: PauseRow | null | undefined): boolean {
  if (row?.notifications_paused !== true) return false;
  const until = row.notifications_paused_until;
  if (!until) return true;
  const untilMs = Date.parse(until);
  return !Number.isFinite(untilMs) || untilMs > Date.now();
}

export async function isEventNotificationsPaused(eventId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('events')
    .select('notifications_paused, notifications_paused_until')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  return isEventNotificationsPausedActive(data as PauseRow | null);
}
