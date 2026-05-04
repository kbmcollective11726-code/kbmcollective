import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { playInAppNotificationFeedback } from '../lib/inAppNotificationFeedback';

/**
 * Single Realtime subscription: when a notification row is inserted for this user,
 * play haptic + in-app sound. Mounted once from root layout (avoids duplicate feedback
 * from HeaderNotificationBell / HamburgerMenu / AnnouncementBanner).
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

    const channel = supabase
      .channel(`in-app-notification-feedback-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { id?: string } | null;
          const id = row?.id;
          if (!id) return;
          prune();
          if (seenIdsRef.current.has(id)) return;
          seenIdsRef.current.set(id, Date.now());
          void playInAppNotificationFeedback();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return null;
}
