import { supabase } from './supabase';

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
  event_id: string | null;
  /** Parsed JSON from DB; keys are normalized to strings */
  data?: Record<string, string>;
};

/** Supabase may return jsonb as object or (rarely) a JSON string */
export function parseNotificationData(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw == null) return out;
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return out;
    }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, string>;
  }
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && v !== '') out[k] = String(v);
  }
  return out;
}

export function isNotificationRows(value: unknown): value is NotificationRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        row &&
        typeof (row as NotificationRow).id === 'string' &&
        typeof (row as NotificationRow).type === 'string' &&
        typeof (row as NotificationRow).title === 'string' &&
        typeof (row as NotificationRow).created_at === 'string',
    )
  );
}

/** Latest notifications for the event (chat messages excluded — they live in the Chat hub). */
export async function fetchEventNotificationRows(userId: string, eventId: string): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, is_read, created_at, event_id, data')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? [])
    .map((row: NotificationRow & { data?: unknown }) => ({
      ...row,
      data: parseNotificationData(row.data),
    }))
    .filter((row) => row.type !== 'message');
}
