import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import type { NotificationResponse } from 'expo-notifications';
import { useRouter, useRootNavigationState } from 'expo-router';
import { isPasswordRecoveryLaunchUrl } from './passwordRecoveryLaunchUrl';
import { peekPendingPasswordRecoveryUrl, setPendingPasswordRecoveryUrl } from './pendingRecoveryUrl';
import { setPendingBadgeToken } from './pendingBadgeUrl';
import { openBadgeDeepLink, tryOpenPendingBadgeDeepLink } from './openBadgeDeepLink';
import { safeRouterReplace } from './safeNavigate';
import { ensureCurrentEventForId, pickNotificationBoothId } from './ensureEventForNotification';
import { useAuthStore } from '../stores/authStore';
import { isBadgeDeepLinkUrl, parseBadgeTokenFromQrData } from './badgeRpc';

function navigateToPost(router: ReturnType<typeof useRouter>, postId: string) {
  safeRouterReplace(router, `/(tabs)/feed/comment/${encodeURIComponent(postId)}` as any);
}

function navigateToChat(router: ReturnType<typeof useRouter>, userId: string) {
  safeRouterReplace(router, `/profile/chat/${userId}` as any);
}

function navigateToGroup(router: ReturnType<typeof useRouter>, groupId: string) {
  safeRouterReplace(router, `/profile/groups/${groupId}` as any);
}

function canOpenDeepLinksNow(navigationReady: boolean): boolean {
  return navigationReady && !useAuthStore.getState().isLoading;
}

function queueOrOpenBadge(router: ReturnType<typeof useRouter>, token: string, navigationReady: boolean) {
  setPendingBadgeToken(token);
  if (!canOpenDeepLinksNow(navigationReady)) return;
  void openBadgeDeepLink(router, token);
}

/** Cold start: iOS delivers launch URL once — capture before nested layouts unmount the listener. */
let initialLaunchUrlFetched = false;

let deepLinkListenerRefCount = 0;

/**
 * Handles deep links and push notification taps into the app.
 * collectivelive://post/<id> or push data.post_id -> navigate to Feed and open that post's comments.
 * Skips notification listeners in Expo Go (push not supported in SDK 53+).
 */
export function useDeepLink() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const navigationReady = !!rootNavigationState?.key;
  const authLoading = useAuthStore((s) => s.isLoading);
  const navigationReadyRef = useRef(navigationReady);
  navigationReadyRef.current = navigationReady;

  // After auth + navigation are ready, open reset-password or queued badge scan (cold start from QR).
  useEffect(() => {
    if (!navigationReady || authLoading) return;

    const p = peekPendingPasswordRecoveryUrl();
    if (p && isPasswordRecoveryLaunchUrl(p)) {
      safeRouterReplace(router, '/(auth)/reset-password' as any);
      return;
    }

    void tryOpenPendingBadgeDeepLink(router);
  }, [navigationReady, authLoading, router]);

  useEffect(() => {
    deepLinkListenerRefCount += 1;
    if (deepLinkListenerRefCount > 1) {
      return () => {
        deepLinkListenerRefCount -= 1;
      };
    }

    const handleUrl = (url: string) => {
      try {
        if (isPasswordRecoveryLaunchUrl(url)) {
          setPendingPasswordRecoveryUrl(url);
          if (canOpenDeepLinksNow(navigationReadyRef.current)) {
            safeRouterReplace(router, '/(auth)/reset-password' as any);
          }
          return;
        }

        const badgeToken = parseBadgeTokenFromQrData(url);
        if (badgeToken && isBadgeDeepLinkUrl(url)) {
          queueOrOpenBadge(router, badgeToken, navigationReadyRef.current);
          return;
        }

        if (!canOpenDeepLinksNow(navigationReadyRef.current)) return;

        const parsed = Linking.parse(url);
        const path = parsed.path ?? '';
        const hostname = (parsed as { hostname?: string }).hostname ?? '';
        const segment = path.startsWith('/') ? path.slice(1).split('/') : path.split('/');
        if (hostname === 'schedule' || segment[0] === 'schedule') {
          safeRouterReplace(router, '/(tabs)/schedule' as any);
          return;
        }
        const qp = (parsed.queryParams ?? {}) as Record<string, string | undefined>;
        const badgeT = qp.t ?? qp.token;
        if (parsed.hostname === 'badge' && typeof badgeT === 'string' && badgeT.length > 0) {
          queueOrOpenBadge(router, badgeT, navigationReadyRef.current);
          return;
        }
        if (segment[0] === 'post' && segment[1]) {
          navigateToPost(router, segment[1]);
        } else if (segment[0] === 'chat' && segment[1]) {
          navigateToChat(router, segment[1]);
        } else if (segment[0] === 'group' && segment[1]) {
          navigateToGroup(router, segment[1]);
        } else if (segment[0] === 'expo' && segment[1]) {
          safeRouterReplace(router, `/(tabs)/expo/${segment[1]}` as any);
        }
      } catch (_) {
        // ignore parse errors
      }
    };

    if (!initialLaunchUrlFetched) {
      initialLaunchUrlFetched = true;
      void Linking.getInitialURL().then((url) => {
        if (url) handleUrl(url);
      });
    }

    const linkSub = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    let notifSub: { remove: () => void } | null = null;
    if (navigationReady && Constants.appOwnership !== 'expo') {
      const Notifications = require('expo-notifications');
      const handleNotificationResponse = (response: NotificationResponse) => {
        const data = response.notification.request.content.data as {
          post_id?: string;
          chat_user_id?: string;
          group_id?: string;
          url?: string;
          type?: string;
          boothId?: string;
          booth_id?: string;
          session_id?: string;
          event_id?: string;
        };
        const boothId = pickNotificationBoothId(data);
        const openBooth = async () => {
          if (!boothId) return;
          if (data?.event_id) {
            const isPlatformAdmin = useAuthStore.getState().user?.is_platform_admin === true;
            await ensureCurrentEventForId(data.event_id, isPlatformAdmin);
          }
          safeRouterReplace(router, `/(tabs)/expo/${boothId}` as any);
        };
        if (data?.type === 'session_reminder' || (data?.session_id && data?.url?.includes('schedule'))) {
          safeRouterReplace(router, '/(tabs)/schedule' as any);
          return;
        }
        if (data?.type === 'meeting_reminder' && boothId) {
          void openBooth();
          return;
        }
        if (data?.post_id) {
          navigateToPost(router, data.post_id);
          return;
        }
        if (data?.chat_user_id) {
          navigateToChat(router, data.chat_user_id);
          return;
        }
        if (data?.group_id) {
          navigateToGroup(router, data.group_id);
          return;
        }
        if (boothId) {
          void openBooth();
          return;
        }
        if (typeof data?.url === 'string') {
          if (data.url.includes('schedule')) {
            safeRouterReplace(router, '/(tabs)/schedule' as any);
            return;
          }
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
            if (m?.[1]) safeRouterReplace(router, `/(tabs)/expo/${m[1]}` as any);
          }
        }
      };
      notifSub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
      Notifications.getLastNotificationResponseAsync().then((response: NotificationResponse | null) => {
        if (response) handleNotificationResponse(response);
      });
    }

    return () => {
      deepLinkListenerRefCount -= 1;
      linkSub.remove();
      notifSub?.remove();
    };
  }, [router, navigationReady]);
}
