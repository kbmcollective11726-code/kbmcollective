import type { Event } from './types';

/** Number of days after event end_date that the event stays accessible (for non–platform admins). */
export const EVENT_ACCESS_DAYS_AFTER_END = 5;

/**
 * True if the event is still accessible.
 * - Platform admins (super admins): can always access any event, including inactive or ended > 5 days ago.
 * - Disabled events (is_active = false): only accessible when isPlatformAdmin is true.
 * - Enabled events: accessible until EVENT_ACCESS_DAYS_AFTER_END days after end_date.
 */
export function isEventAccessible(event: Event | null | undefined, isPlatformAdmin?: boolean): boolean {
  if (!event) return false;
  if (isPlatformAdmin === true) return true;
  if (!event.is_active) return false;
  const endStr = event.end_date?.trim();
  if (!endStr || endStr.length < 10) return true; // no end date, treat as accessible
  const endDate = new Date(endStr.slice(0, 10));
  if (Number.isNaN(endDate.getTime())) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - EVENT_ACCESS_DAYS_AFTER_END);
  cutoff.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);
  return endDate >= cutoff;
}
