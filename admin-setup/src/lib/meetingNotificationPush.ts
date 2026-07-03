import { supabase, supabaseUrl, edgeFunctionHeaders } from './supabase';
import { refreshSupabaseSessionIfNeeded } from './refreshSupabaseSession';
import { formatMeetingPushNote } from './formatMeetingPushNote';
import { isEventNotificationsPaused } from './eventNotificationsPaused';
import { fetchBoothRepUserIds } from './boothRepUserIds';

const INSERT_BATCH = 80;
const PUSH_BATCH = 80;

function pushNoteFromResponse(
  data: { error?: string; sent?: number; message?: string },
  resOk: boolean,
  resStatusText: string
) {
  if (!resOk) return formatMeetingPushNote(data?.error ?? resStatusText);
  if ((data?.sent ?? 0) === 0 && data?.message) return formatMeetingPushNote(String(data.message));
  return undefined;
}

async function attendeeDisplayName(attendeeId: string, provided?: string): Promise<string> {
  const trimmed = provided?.trim();
  if (trimmed) return trimmed;
  const { data } = await supabase.from('users').select('full_name').eq('id', attendeeId).maybeSingle();
  return (data as { full_name?: string | null } | null)?.full_name?.trim() || 'An attendee';
}

async function sendMeetingPushToUsers(
  userIds: string[],
  eventId: string,
  boothId: string,
  title: string,
  body: string
): Promise<{ error: string | null; pushError?: string }> {
  const recipients = [...new Set(userIds.filter(Boolean))];
  if (recipients.length === 0) return { error: null };

  if (await isEventNotificationsPaused(eventId)) {
    return { error: null };
  }

  const rows = recipients.map((user_id) => ({
    user_id,
    event_id: eventId,
    type: 'meeting' as const,
    title,
    body,
    data: { booth_id: boothId },
  }));

  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const chunk = rows.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from('notifications').insert(chunk);
    if (error) return { error: error.message };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return {
      error: null,
      pushError: formatMeetingPushNote('No session; in-app notification saved but push was not sent.'),
    };
  }

  const pushErrors: string[] = [];
  for (let i = 0; i < recipients.length; i += PUSH_BATCH) {
    const batch = recipients.slice(i, i + PUSH_BATCH);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-announcement-push`, {
        method: 'POST',
        headers: edgeFunctionHeaders(session.access_token),
        body: JSON.stringify({
          event_id: eventId,
          title,
          body,
          recipient_user_ids: batch,
          booth_id: boothId,
        }),
      });
      const data = (await res.json()) as { error?: string; sent?: number; message?: string };
      const pushError = pushNoteFromResponse(data, res.ok, res.statusText);
      if (pushError) pushErrors.push(pushError);
    } catch (e) {
      pushErrors.push(formatMeetingPushNote(e instanceof Error ? e.message : 'Push request failed'));
    }
  }

  return { error: null, pushError: pushErrors[0] };
}

function mergeNotifyResults(
  a: { error: string | null; pushError?: string },
  b: { error: string | null; pushError?: string }
): { error: string | null; pushError?: string } {
  return {
    error: a.error ?? b.error,
    pushError: a.pushError ?? b.pushError,
  };
}

/** Notify assigned attendee + all booth representatives (primary + additional reps). */
async function notifyAttendeeAndBoothReps(
  attendeeId: string,
  eventId: string,
  boothId: string,
  attendeeTitle: string,
  attendeeBody: string,
  vendorTitle: string,
  vendorBody: string
): Promise<{ error: string | null; pushError?: string }> {
  await refreshSupabaseSessionIfNeeded();

  let repIds: string[] = [];
  try {
    repIds = (await fetchBoothRepUserIds(boothId)).filter((id) => id !== attendeeId);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'Could not load booth representatives',
    };
  }

  const attendeeResult = await sendMeetingPushToUsers([attendeeId], eventId, boothId, attendeeTitle, attendeeBody);
  if (repIds.length === 0) return attendeeResult;

  const vendorResult = await sendMeetingPushToUsers(repIds, eventId, boothId, vendorTitle, vendorBody);
  return mergeNotifyResults(attendeeResult, vendorResult);
}

export async function notifyMeetingAssigned(
  attendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string,
  whenLabel: string,
  attendeeName?: string
): Promise<{ error: string | null; pushError?: string }> {
  const name = await attendeeDisplayName(attendeeId, attendeeName);
  return notifyAttendeeAndBoothReps(
    attendeeId,
    eventId,
    boothId,
    'Meeting assigned',
    `You have a meeting with ${vendorName} on ${whenLabel}.`,
    'Booth meeting scheduled',
    `Meeting scheduled: ${name} on ${whenLabel}.`
  );
}

export async function notifyMeetingUpdated(
  attendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string,
  whenLabel: string,
  attendeeName?: string
): Promise<{ error: string | null; pushError?: string }> {
  const name = await attendeeDisplayName(attendeeId, attendeeName);
  return notifyAttendeeAndBoothReps(
    attendeeId,
    eventId,
    boothId,
    'Meeting updated',
    `Your meeting with ${vendorName} is now ${whenLabel}.`,
    'Booth meeting updated',
    `Meeting updated: ${name} is now ${whenLabel}.`
  );
}

export async function notifyMeetingReassignedAway(
  previousAttendeeId: string,
  eventId: string,
  vendorName: string,
  _boothId: string,
  _whenLabel?: string,
  _attendeeName?: string
): Promise<{ error: string | null; pushError?: string }> {
  return sendMeetingPushToUsers(
    [previousAttendeeId],
    eventId,
    _boothId,
    'Meeting updated',
    `Your meeting with ${vendorName} was reassigned to another attendee.`
  );
}

export type MeetingNotifyVariant = 'cancelled' | 'slot_removed';

export async function notifyMeetingStatusToAttendee(
  attendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string,
  variant: MeetingNotifyVariant,
  attendeeName?: string,
  whenLabel?: string
): Promise<{ error: string | null; pushError?: string }> {
  const name = await attendeeDisplayName(attendeeId, attendeeName);
  const attendeeTitle = variant === 'cancelled' ? 'Meeting cancelled' : 'Meeting removed';
  const attendeeBody =
    variant === 'cancelled'
      ? `Your meeting with ${vendorName} has been cancelled.`
      : `Your meeting with ${vendorName} was removed (time slot deleted).`;
  const vendorTitle = variant === 'cancelled' ? 'Booth meeting cancelled' : 'Booth meeting removed';
  const vendorBody =
    variant === 'cancelled'
      ? whenLabel
        ? `Meeting cancelled: ${name} on ${whenLabel}.`
        : `Meeting cancelled: ${name}.`
      : whenLabel
        ? `Meeting removed: ${name} on ${whenLabel} (slot deleted).`
        : `Meeting removed: ${name} (slot deleted).`;

  return notifyAttendeeAndBoothReps(
    attendeeId,
    eventId,
    boothId,
    attendeeTitle,
    attendeeBody,
    vendorTitle,
    vendorBody
  );
}
