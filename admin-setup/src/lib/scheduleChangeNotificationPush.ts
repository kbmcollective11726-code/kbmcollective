import { supabase, supabaseUrl, edgeFunctionHeaders } from './supabase';
import { refreshSupabaseSessionIfNeeded } from './refreshSupabaseSession';
import { isEventNotificationsPaused } from './eventNotificationsPaused';

export type ScheduleChangeKind = 'added' | 'updated' | 'removed' | 'bulk_added' | 'cleared';

const INSERT_BATCH = 80;
const PUSH_RECIPIENT_BATCH = 80;

export type ScheduleChangeNotifyResult = {
  error: string | null;
  pushError?: string;
  recipientCount: number;
  skippedPause?: boolean;
};

function copyForKind(kind: ScheduleChangeKind, sessionTitle?: string, bulkCount?: number): { title: string; body: string } {
  const name = sessionTitle?.trim() || 'A session';
  switch (kind) {
    case 'added':
      return {
        title: 'New session added',
        body: `"${name}" was added to the schedule. Check the Agenda tab.`,
      };
    case 'updated':
      return {
        title: 'Schedule updated',
        body: `"${name}" was updated. Check the Agenda tab for details.`,
      };
    case 'removed':
      return {
        title: 'Session removed',
        body: `"${name}" was removed from the schedule.`,
      };
    case 'bulk_added':
      return {
        title: 'Schedule updated',
        body: `${bulkCount ?? 0} session(s) were added to the agenda. Check the Agenda tab.`,
      };
    case 'cleared':
      return {
        title: 'Schedule updated',
        body:
          bulkCount != null && bulkCount > 0
            ? `${bulkCount} session(s) were removed from the agenda. Check the Agenda tab.`
            : 'The event agenda was cleared. Check the Agenda tab for the latest sessions.',
      };
  }
}

async function insertNotificationRows(
  rows: { user_id: string; event_id: string; type: 'schedule_change'; title: string; body: string; data: Record<string, string> }[]
): Promise<string | null> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk = rows.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from('notifications').insert(chunk);
    if (error) return error.message;
  }
  return null;
}

async function sendPushBatches(
  accessToken: string,
  eventId: string,
  title: string,
  body: string,
  recipientIds: string[]
): Promise<{ pushError?: string; totalSent: number }> {
  let totalSent = 0;
  const pushErrors: string[] = [];

  for (let i = 0; i < recipientIds.length; i += PUSH_RECIPIENT_BATCH) {
    const batch = recipientIds.slice(i, i + PUSH_RECIPIENT_BATCH);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-announcement-push`, {
        method: 'POST',
        headers: edgeFunctionHeaders(accessToken),
        body: JSON.stringify({
          event_id: eventId,
          title,
          body,
          recipient_user_ids: batch,
        }),
      });
      const payload = (await res.json()) as { error?: string; sent?: number; message?: string };
      if (!res.ok) {
        pushErrors.push(payload.error ?? res.statusText);
        continue;
      }
      totalSent += payload.sent ?? 0;
      if ((payload.sent ?? 0) === 0 && payload.message) {
        pushErrors.push(payload.message);
      }
    } catch (e) {
      pushErrors.push(e instanceof Error ? e.message : 'Push request failed');
    }
  }

  return {
    totalSent,
    pushError: pushErrors.length > 0 ? pushErrors[0] : undefined,
  };
}

/** Human-readable status for cadmin schedule actions. */
export function formatScheduleNotifyResult(result: ScheduleChangeNotifyResult): string {
  if (result.skippedPause) return 'Notifications are paused — members were not alerted.';
  if (result.error) return `Member alerts failed: ${result.error}`;
  if (result.recipientCount === 0) return 'No other event members to alert.';
  if (result.pushError) {
    return `In-app alerts sent to ${result.recipientCount} member(s). Push note: ${result.pushError}`;
  }
  return `Alerts sent to ${result.recipientCount} member(s) (in-app + push).`;
}

/**
 * In-app + push for all event members when the cadmin schedule changes.
 * Skipped when event notifications are paused.
 */
export async function notifyScheduleChange(
  eventId: string,
  kind: ScheduleChangeKind,
  options?: { sessionTitle?: string; sessionId?: string; bulkCount?: number }
): Promise<ScheduleChangeNotifyResult> {
  await refreshSupabaseSessionIfNeeded();

  if (await isEventNotificationsPaused(eventId)) {
    return { error: null, recipientCount: 0, skippedPause: true };
  }

  const { data: members, error: membersErr } = await supabase
    .from('event_members')
    .select('user_id')
    .eq('event_id', eventId);
  if (membersErr) return { error: membersErr.message, recipientCount: 0 };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const callerId = session?.user?.id;
  const recipientIds = (members ?? [])
    .map((m: { user_id: string }) => m.user_id)
    .filter((id: string) => id && id !== callerId);

  if (recipientIds.length === 0) {
    return { error: null, recipientCount: 0 };
  }

  const { title, body } = copyForKind(kind, options?.sessionTitle, options?.bulkCount);
  const data: Record<string, string> = options?.sessionId ? { session_id: options.sessionId } : {};

  const rows = recipientIds.map((user_id) => ({
    user_id,
    event_id: eventId,
    type: 'schedule_change' as const,
    title,
    body,
    data,
  }));

  const insertErr = await insertNotificationRows(rows);
  if (insertErr) return { error: insertErr, recipientCount: recipientIds.length };

  if (!session?.access_token) {
    return {
      error: null,
      pushError: 'In-app notifications saved; push was not sent (no session).',
      recipientCount: recipientIds.length,
    };
  }

  const push = await sendPushBatches(session.access_token, eventId, title, body, recipientIds);
  return {
    error: null,
    pushError: push.pushError,
    recipientCount: recipientIds.length,
  };
}
