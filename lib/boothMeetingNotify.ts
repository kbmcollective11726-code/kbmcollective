import { supabase } from './supabase';
import { createNotificationAndPush } from './notifications';

async function fetchBoothRepUserIds(boothId: string): Promise<string[]> {
  const [{ data: booth }, { data: reps, error: repErr }] = await Promise.all([
    supabase.from('vendor_booths').select('contact_user_id').eq('id', boothId).maybeSingle(),
    supabase.from('vendor_booth_reps').select('user_id').eq('booth_id', boothId),
  ]);
  if (repErr) throw repErr;

  const ids = new Set<string>();
  const contact = (booth as { contact_user_id?: string | null } | null)?.contact_user_id;
  if (contact) ids.add(contact);
  for (const row of reps ?? []) {
    const uid = (row as { user_id: string }).user_id;
    if (uid) ids.add(uid);
  }
  return [...ids];
}

async function attendeeDisplayName(attendeeId: string, provided?: string): Promise<string> {
  const trimmed = provided?.trim();
  if (trimmed) return trimmed;
  const { data } = await supabase.from('users').select('full_name').eq('id', attendeeId).maybeSingle();
  return (data as { full_name?: string | null } | null)?.full_name?.trim() || 'An attendee';
}

async function notifyUsers(
  userIds: string[],
  eventId: string,
  boothId: string,
  title: string,
  body: string
): Promise<void> {
  const recipients = [...new Set(userIds.filter(Boolean))];
  for (const uid of recipients) {
    await createNotificationAndPush(uid, eventId, 'meeting', title, body, { booth_id: boothId });
  }
}

async function notifyAttendeeAndBoothReps(
  attendeeId: string,
  eventId: string,
  boothId: string,
  attendeeTitle: string,
  attendeeBody: string,
  vendorTitle: string,
  vendorBody: string
): Promise<void> {
  const repIds = (await fetchBoothRepUserIds(boothId)).filter((id) => id !== attendeeId);
  await notifyUsers([attendeeId], eventId, boothId, attendeeTitle, attendeeBody);
  if (repIds.length > 0) {
    await notifyUsers(repIds, eventId, boothId, vendorTitle, vendorBody);
  }
}

export async function notifyBoothMeetingAssigned(
  attendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string,
  whenLabel: string,
  attendeeName?: string
): Promise<void> {
  const name = await attendeeDisplayName(attendeeId, attendeeName);
  await notifyAttendeeAndBoothReps(
    attendeeId,
    eventId,
    boothId,
    'Meeting assigned',
    `You have a meeting with ${vendorName} on ${whenLabel}.`,
    'Booth meeting scheduled',
    `Meeting scheduled: ${name} on ${whenLabel}.`
  );
}

export async function notifyBoothMeetingUpdated(
  attendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string,
  whenLabel: string,
  attendeeName?: string
): Promise<void> {
  const name = await attendeeDisplayName(attendeeId, attendeeName);
  await notifyAttendeeAndBoothReps(
    attendeeId,
    eventId,
    boothId,
    'Meeting updated',
    `Your meeting with ${vendorName} is now ${whenLabel}.`,
    'Booth meeting updated',
    `Meeting updated: ${name} is now ${whenLabel}.`
  );
}

export async function notifyBoothMeetingReassignedAway(
  previousAttendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string
): Promise<void> {
  await notifyUsers(
    [previousAttendeeId],
    eventId,
    boothId,
    'Meeting updated',
    `Your meeting with ${vendorName} was reassigned to another attendee.`
  );
}

export async function notifyBoothMeetingCancelled(
  attendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string,
  attendeeName?: string,
  whenLabel?: string
): Promise<void> {
  const name = await attendeeDisplayName(attendeeId, attendeeName);
  const vendorBody = whenLabel
    ? `Meeting cancelled: ${name} on ${whenLabel}.`
    : `Meeting cancelled: ${name}.`;
  await notifyAttendeeAndBoothReps(
    attendeeId,
    eventId,
    boothId,
    'Meeting cancelled',
    `Your meeting with ${vendorName} has been cancelled.`,
    'Booth meeting cancelled',
    vendorBody
  );
}

export async function notifyBoothMeetingSlotRemoved(
  attendeeId: string,
  eventId: string,
  vendorName: string,
  boothId: string,
  attendeeName?: string,
  whenLabel?: string
): Promise<void> {
  const name = await attendeeDisplayName(attendeeId, attendeeName);
  const vendorBody = whenLabel
    ? `Meeting removed: ${name} on ${whenLabel} (slot deleted).`
    : `Meeting removed: ${name} (slot deleted).`;
  await notifyAttendeeAndBoothReps(
    attendeeId,
    eventId,
    boothId,
    'Meeting removed',
    `Your meeting with ${vendorName} was removed (time slot deleted).`,
    'Booth meeting removed',
    vendorBody
  );
}

/** One summary notification for booth reps when all meetings are cancelled at once. */
export async function notifyBoothAllMeetingsCancelled(eventId: string, boothId: string): Promise<void> {
  const repIds = await fetchBoothRepUserIds(boothId);
  if (repIds.length === 0) return;
  await notifyUsers(
    repIds,
    eventId,
    boothId,
    'Booth meetings cancelled',
    'All scheduled meetings at your booth were cancelled.'
  );
}
