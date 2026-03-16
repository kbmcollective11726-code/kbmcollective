import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import type { NotificationResponse } from 'expo-notifications';
import { useRouter } from 'expo-router';

function navigateToPost(router: ReturnType<typeof useRouter>, postId: string) {
  router.replace({ pathname: '/feed', params: { postId } } as any);
}

function navigateToChat(router: ReturnType<typeof useRouter>, userId: string) {
  router.replace(`/profile/chat/${userId}` as any);
}

function navigateToGroup(router: ReturnType<typeof useRouter>, groupId: string) {
  router.replace(`/profile/groups/${groupId}` as any);
}

/**
 * Handles deep links and push notification taps into the app.
 * collectivelive://post/<id> or push data.post_id -> navigate to Feed and open that post's comments.
 * Skips notification listeners in Expo Go (push not supported in SDK 53+).
 */
export function useDeepLink() {
  const router = useRouter();

  useEffect(() => {
    const handleUrl = (url: string) => {
      try {
        const parsed = Linking.parse(url);
        const path = parsed.path ?? '';
        const segment = path.startsWith('/') ? path.slice(1).split('/') : path.split('/');
        if (segment[0] === 'post' && segment[1]) {
          navigateToPost(router, segment[1]);
        } else if (segment[0] === 'chat' && segment[1]) {
          navigateToChat(router, segment[1]);
        } else if (segment[0] === 'group' && segment[1]) {
          navigateToGroup(router, segment[1]);
        } else if (segment[0] === 'expo' && segment[1]) {
          router.replace(`/(tabs)/expo/${segment[1]}` as any);
        }
      } catch (_) {
        // ignore parse errors
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    const linkSub = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    let notifSub: { remove: () => void } | null = null;
    if (Constants.appOwnership !== 'expo') {
      const Notifications = require('expo-notifications');
      const handleNotificationResponse = (response: NotificationResponse) => {
        const data = response.notification.request.content.data as { post_id?: string; chat_user_id?: string; group_id?: string; url?: string; type?: string; boothId?: string };
        if (data?.type === 'meeting_reminder' && data?.boothId) {
          router.replace(`/(tabs)/expo/${data.boothId}` as any);
        } else if (data?.post_id) {
          navigateToPost(router, data.post_id);
        } else if (data?.chat_user_id) {
          navigateToChat(router, data.chat_user_id);
        } else if (data?.group_id) {
          navigateToGroup(router, data.group_id);
        } else if (data?.boothId) {
          router.replace(`/(tabs)/expo/${data.boothId}` as any);
        } else if (typeof data?.url === 'string') {
          if (data.url.includes('/post/')) {
            const m = data.url.match(/\/post\/([^/?#]+)/);
            if (m?.[1]) navigateToPost(router, m[1]);
          } else if (data.url.includes('/chat/')) {
            const m = data.url.match(/\/chat\/([^/?#]+)/);
            if (m?.[1]) navigateToChat(router, m[1]);
          } else if (data.url.includes('/group/')) {
            const m = data.url.match(/\/group\/([^/?#]+)/);
            if (m?.[1]) navigateToGroup(router, m[1]);
          } else if (data.url.includes('/expo/')) {
            const m = data.url.match(/\/expo\/([^/?#]+)/);
            if (m?.[1]) router.replace(`/(tabs)/expo/${m[1]}` as any);
          }
        }
      };
      notifSub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
      Notifications.getLastNotificationResponseAsync().then((response: NotificationResponse | null) => {
        if (response) handleNotificationResponse(response);
      });
    }

    return () => {
      linkSub.remove();
      notifSub?.remove();
    };
  }, [router]);
}
