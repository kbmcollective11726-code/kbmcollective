import { supabase, supabaseUrl, edgeFunctionHeaders } from './supabase';
import { refreshSupabaseSessionIfNeeded } from './refreshSupabaseSession';

/**
 * In-app notification + Expo push for a B2B meeting assignment (same pattern as the mobile app).
 * Push uses the `send-announcement-push` Edge Function with the current admin session.
 */
export async function notifyMeetingAssigned(
  attendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string,
  whenLabel: string
): Promise<{ error: string | null; pushError?: string }> {
  await refreshSupabaseSessionIfNeeded();

  const title = 'Meeting assigned';
  const body = `You have a meeting with ${vendorName} on ${whenLabel}.`;
  const { error } = await supabase.from('notifications').insert({
    user_id: attendeeId,
    event_id: eventId,
    type: 'meeting',
    title,
    body,
    data: { booth_id: boothId },
  });
  if (error) return { error: error.message };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { error: null, pushError: 'No session; in-app notification saved but push was not sent.' };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-announcement-push`, {
      method: 'POST',
      headers: edgeFunctionHeaders(session.access_token),
      body: JSON.stringify({
        event_id: eventId,
        title,
        body,
        recipient_user_ids: [attendeeId],
        booth_id: boothId,
      }),
    });
    const data = (await res.json()) as { error?: string; sent?: number; message?: string };
    if (!res.ok) {
      return { error: null, pushError: data?.error ?? res.statusText };
    }
    if ((data?.sent ?? 0) === 0 && data?.message) {
      return { error: null, pushError: String(data.message) };
    }
  } catch (e) {
    return { error: null, pushError: e instanceof Error ? e.message : 'Push request failed' };
  }
  return { error: null };
}

/**
 * In-app + push after an admin changes meeting time and/or reassigns (current attendee keeps the slot).
 */
export async function notifyMeetingUpdated(
  attendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string,
  whenLabel: string
): Promise<{ error: string | null; pushError?: string }> {
  await refreshSupabaseSessionIfNeeded();

  const title = 'Meeting updated';
  const body = `Your meeting with ${vendorName} is now ${whenLabel}.`;

  const { error } = await supabase.from('notifications').insert({
    user_id: attendeeId,
    event_id: eventId,
    type: 'meeting',
    title,
    body,
    data: { booth_id: boothId },
  });
  if (error) return { error: error.message };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { error: null, pushError: 'No session; in-app notification saved but push was not sent.' };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-announcement-push`, {
      method: 'POST',
      headers: edgeFunctionHeaders(session.access_token),
      body: JSON.stringify({
        event_id: eventId,
        title,
        body,
        recipient_user_ids: [attendeeId],
        booth_id: boothId,
      }),
    });
    const data = (await res.json()) as { error?: string; sent?: number; message?: string };
    if (!res.ok) {
      return { error: null, pushError: data?.error ?? res.statusText };
    }
    if ((data?.sent ?? 0) === 0 && data?.message) {
      return { error: null, pushError: String(data.message) };
    }
  } catch (e) {
    return { error: null, pushError: e instanceof Error ? e.message : 'Push request failed' };
  }
  return { error: null };
}

/** Previous attendee when admin assigns the slot to someone else. */
export async function notifyMeetingReassignedAway(
  previousAttendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string
): Promise<{ error: string | null; pushError?: string }> {
  await refreshSupabaseSessionIfNeeded();

  const title = 'Meeting updated';
  const body = `Your meeting with ${vendorName} was reassigned to another attendee.`;

  const { error } = await supabase.from('notifications').insert({
    user_id: previousAttendeeId,
    event_id: eventId,
    type: 'meeting',
    title,
    body,
    data: { booth_id: boothId },
  });
  if (error) return { error: error.message };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { error: null, pushError: 'No session; in-app notification saved but push was not sent.' };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-announcement-push`, {
      method: 'POST',
      headers: edgeFunctionHeaders(session.access_token),
      body: JSON.stringify({
        event_id: eventId,
        title,
        body,
        recipient_user_ids: [previousAttendeeId],
        booth_id: boothId,
      }),
    });
    const data = (await res.json()) as { error?: string; sent?: number; message?: string };
    if (!res.ok) {
      return { error: null, pushError: data?.error ?? res.statusText };
    }
    if ((data?.sent ?? 0) === 0 && data?.message) {
      return { error: null, pushError: String(data.message) };
    }
  } catch (e) {
    return { error: null, pushError: e instanceof Error ? e.message : 'Push request failed' };
  }
  return { error: null };
}

export type MeetingNotifyVariant = 'cancelled' | 'slot_removed';

/**
 * In-app + push when an admin cancels a B2B meeting or removes the slot (web admin).
 */
export async function notifyMeetingStatusToAttendee(
  attendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string,
  variant: MeetingNotifyVariant
): Promise<{ error: string | null; pushError?: string }> {
  await refreshSupabaseSessionIfNeeded();

  const title = variant === 'cancelled' ? 'Meeting cancelled' : 'Meeting removed';
  const body =
    variant === 'cancelled'
      ? `Your meeting with ${vendorName} has been cancelled.`
      : `Your meeting with ${vendorName} was removed (time slot deleted).`;

  const { error } = await supabase.from('notifications').insert({
    user_id: attendeeId,
    event_id: eventId,
    type: 'meeting',
    title,
    body,
    data: { booth_id: boothId },
  });
  if (error) return { error: error.message };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { error: null, pushError: 'No session; in-app notification saved but push was not sent.' };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-announcement-push`, {
      method: 'POST',
      headers: edgeFunctionHeaders(session.access_token),
      body: JSON.stringify({
        event_id: eventId,
        title,
        body,
        recipient_user_ids: [attendeeId],
        booth_id: boothId,
      }),
    });
    const data = (await res.json()) as { error?: string; sent?: number; message?: string };
    if (!res.ok) {
      return { error: null, pushError: data?.error ?? res.statusText };
    }
    if ((data?.sent ?? 0) === 0 && data?.message) {
      return { error: null, pushError: String(data.message) };
    }
  } catch (e) {
    return { error: null, pushError: e instanceof Error ? e.message : 'Push request failed' };
  }
  return { error: null };
}
