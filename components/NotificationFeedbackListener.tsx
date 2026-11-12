import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { subscribeUserNotifications } from '../lib/notificationsRealtime';
import { playInAppNotificationFeedback } from '../lib/inAppNotificationFeedback';

/**
 * Uses the shared notifications Realtime bus. Mounted once from root layout.
 */
export default function NotificationFeedbackListener() {
  const user = useAuthStore((s) => s.user);
  const seenIdsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!user?.id) return;

    const prune = () => {
      const now = Date.now();
      const m = seenIdsRef.current;
      for (const [id, t] of m) {
        if (now - t > 8000) m.delete(id);
      }
    };

    return subscribeUserNotifications(user.id, {
      onInsert: (row) => {
        const id = row?.id;
        if (!id || typeof id !== 'string') return;
        prune();
        if (seenIdsRef.current.has(id)) return;
        seenIdsRef.current.set(id, Date.now());
        void playInAppNotificationFeedback();
      },
    });
  }, [user?.id]);

  return null;
}
