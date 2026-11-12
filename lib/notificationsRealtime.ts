/**
 * Single Realtime channel for `notifications` per user.
 * Fans out INSERT/UPDATE to subscribers (bell, menu badge, banner, feedback).
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type NotificationRealtimeRow = Record<string, unknown> & {
  id?: string;
  type?: string;
  title?: string | null;
  body?: string | null;
  event_id?: string | null;
  user_id?: string;
  is_read?: boolean;
};

export type NotificationRealtimeHandlers = {
  onInsert?: (row: NotificationRealtimeRow) => void;
  onUpdate?: (row: NotificationRealtimeRow) => void;
};

type Entry = { userId: string; handlers: NotificationRealtimeHandlers };

const subscribers = new Set<Entry>();
let channel: RealtimeChannel | null = null;
let channelUserId: string | null = null;

function teardownChannel() {
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
  channelUserId = null;
}

function ensureChannel(userId: string) {
  if (channel && channelUserId === userId) return;
  teardownChannel();
  channelUserId = userId;
  channel = supabase
    .channel(`notifications-shared:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = (payload.new ?? {}) as NotificationRealtimeRow;
        for (const s of subscribers) {
          if (s.userId !== userId) continue;
          try {
            s.handlers.onInsert?.(row);
          } catch {
            /* ignore subscriber errors */
          }
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = (payload.new ?? {}) as NotificationRealtimeRow;
        for (const s of subscribers) {
          if (s.userId !== userId) continue;
          try {
            s.handlers.onUpdate?.(row);
          } catch {
            /* ignore subscriber errors */
          }
        }
      }
    )
    .subscribe();
}

/** Subscribe to this user's notification INSERT/UPDATE. Returns unsubscribe. */
export function subscribeUserNotifications(
  userId: string,
  handlers: NotificationRealtimeHandlers
): () => void {
  const entry: Entry = { userId, handlers };
  subscribers.add(entry);
  ensureChannel(userId);
  return () => {
    subscribers.delete(entry);
    const stillForUser = [...subscribers].some((s) => s.userId === userId);
    if (!stillForUser && channelUserId === userId) {
      teardownChannel();
    }
  };
}
