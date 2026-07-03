/** Turn technical push API messages into plain language for event admins. */
export function formatMeetingPushNote(raw: string | undefined | null): string {
  const msg = (raw ?? '').trim();
  if (!msg) return '';

  const lower = msg.toLowerCase();
  if (lower.includes('no push token')) {
    return 'In-app notification saved. This attendee has not enabled phone alerts yet — they will see the meeting in the app when they open it (they need to allow notifications on a real device build).';
  }
  if (lower.includes('no session')) {
    return 'In-app notification saved. Phone alert was not sent — refresh the page and sign in again if you need to retry push.';
  }
  if (lower.includes('unauthorized') || lower.includes('401')) {
    return 'In-app notification saved. Phone alert failed — your session may have expired. Refresh and try again.';
  }
  if (lower.includes('push request failed')) {
    return 'In-app notification saved. Phone alert could not be delivered right now — the attendee will still see it in the app.';
  }
  return msg.startsWith('In-app') ? msg : `In-app notification saved. ${msg}`;
}
