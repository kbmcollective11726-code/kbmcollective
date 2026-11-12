import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useLocalSearchParams, useRouter, useRootNavigationState } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { setPendingBadgeToken } from '../lib/pendingBadgeUrl';
import { openBadgeDeepLink } from '../lib/openBadgeDeepLink';
import { safeRouterReplace } from '../lib/safeNavigate';
import { colors } from '../constants/colors';

/**
 * Cold-start target for collectivelive://badge?t=…
 * Expo Router opens this path when the app is launched from the camera QR;
 * warm starts are handled by Linking in useDeepLink instead.
 */
export default function BadgeDeepLinkScreen() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const navigationReady = !!rootNavigationState?.key;
  const { t, token } = useLocalSearchParams<{ t?: string; token?: string }>();
  const isLoading = useAuthStore((s) => s.isLoading);
  const handled = useRef(false);

  const raw = (typeof t === 'string' ? t : typeof token === 'string' ? token : '').trim();

  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    if (raw) setPendingBadgeToken(raw);
  }, [raw]);

  useEffect(() => {
    if (!navigationReady || isLoading || handled.current) return;

    if (!raw) {
      handled.current = true;
      safeRouterReplace(router, '/');
      return;
    }

    handled.current = true;
    void openBadgeDeepLink(router, raw);
  }, [navigationReady, isLoading, raw, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
