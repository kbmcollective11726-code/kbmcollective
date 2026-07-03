import { useEventStore } from '../stores/eventStore';
import { supabase } from './supabase';
import type { Event } from './types';

/** Switch the active event when opening a notification/deep link for another event. */
export async function ensureCurrentEventForId(
  eventId: string,
  isPlatformAdmin?: boolean
): Promise<boolean> {
  if (!eventId) return false;
  const { currentEvent, memberships, setCurrentEvent } = useEventStore.getState();
  if (currentEvent?.id === eventId) return true;

  const row = memberships.find((m) => m.event_id === eventId);
  if (row?.events) {
    await setCurrentEvent(row.events);
    return true;
  }

  if (isPlatformAdmin) {
    const { data } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
    if (data) {
      await setCurrentEvent(data as Event);
      return true;
    }
  }

  return false;
}

export function pickNotificationBoothId(data: Record<string, unknown> | undefined | null): string | null {
  if (!data) return null;
  const id = data.booth_id ?? data.boothId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
