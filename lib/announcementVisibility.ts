/** Supabase PostgREST filter: immediate sends or scheduled rows already delivered. */
export const PUBLISHED_ANNOUNCEMENT_OR_FILTER = 'scheduled_at.is.null,sent_at.not.is.null';

export type AnnouncementListRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  sent_at?: string | null;
  scheduled_at?: string | null;
};

/** When to show in the app UI (delivery time for scheduled, create time for send-now). */
export function announcementDisplayTime(row: Pick<AnnouncementListRow, 'sent_at' | 'created_at'>): string {
  return row.sent_at ?? row.created_at;
}

export function sortAnnouncementsNewestFirst<T extends Pick<AnnouncementListRow, 'sent_at' | 'created_at'>>(
  rows: T[]
): T[] {
  return [...rows].sort(
    (a, b) =>
      new Date(announcementDisplayTime(b)).getTime() - new Date(announcementDisplayTime(a)).getTime()
  );
}
