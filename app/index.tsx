import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../stores/authStore';
import { colors } from '../constants/colors';
import { safeRouterReplace } from '../lib/safeNavigate';
import { peekPendingBadgeToken } from '../lib/pendingBadgeUrl';
import DeepLinkHandler from '../components/DeepLinkHandler';

export default function IndexScreen() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const navigationReady = !!rootNavigationState?.key;
  const { isAuthenticated, isLoading, user, session } = useAuthStore();
  const mustChangePassword = !!session?.user?.user_metadata?.must_change_password;
  const navigated = useRef(false);
  const [showSkip, setShowSkip] = useState(false);

  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShowSkip(true), 1000);
    return () => clearTimeout(t);
  }, []);

  // Navigate as soon as auth state is known. Force password change first if required.
  useEffect(() => {
    if (!navigationReady) return;
    if (isLoading) return;
    if (navigated.current) return;

    // Badge QR cold start — enter tabs/login shell; DeepLinkHandler opens badge-scan once auth is ready.
    if (peekPendingBadgeToken()) {
      navigated.current = true;
      if (isAuthenticated) {
        if (mustChangePassword) {
          safeRouterReplace(router, '/(auth)/change-password');
        } else {
          safeRouterReplace(router, '/(tabs)/home');
        }
      } else {
        safeRouterReplace(router, '/(auth)/login');
      }
      return;
    }

    navigated.current = true;

    if (isAuthenticated) {
      if (mustChangePassword) {
        safeRouterReplace(router, '/(auth)/change-password');
      } else if (user?.is_platform_admin) {
        safeRouterReplace(router, '/profile/admin-all-events');
      } else {
        safeRouterReplace(router, '/(tabs)/home');
      }
    } else {
      safeRouterReplace(router, '/(auth)/login');
    }
  }, [isAuthenticated, isLoading, mustChangePassword, user?.is_platform_admin, router, navigationReady]);

  // Safety: only after auth init finishes — never redirect while isLoading (slow getSession was
  // firing this at 1.5s and sending signed-in users to login = "random sign out" reports).
  useEffect(() => {
    if (!navigationReady) return;
    const t = setTimeout(() => {
      if (navigated.current) return;
      const { isLoading: loading, isAuthenticated: authed } = useAuthStore.getState();
      if (loading) return;
      navigated.current = true;
      safeRouterReplace(router, authed ? '/(tabs)/home' : '/(auth)/login');
    }, 4000);
    return () => clearTimeout(t);
  }, [router, navigationReady]);

  // Last resort if initialize() never clears isLoading (very rare)
  useEffect(() => {
    if (!navigationReady) return;
    const t = setTimeout(() => {
      if (navigated.current) return;
      const { isLoading: loading } = useAuthStore.getState();
      if (!loading) return;
      navigated.current = true;
      safeRouterReplace(router, '/(auth)/login');
    }, 25000);
    return () => clearTimeout(t);
  }, [router, navigationReady]);

  const goToLogin = () => {
    if (!navigationReady) return;
    if (navigated.current) return;
    navigated.current = true;
    safeRouterReplace(router, '/(auth)/login');
  };

  return (
    <>
    <DeepLinkHandler />
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.label}>Loading…</Text>
      {showSkip && (
        <TouchableOpacity style={styles.skip} onPress={goToLogin} activeOpacity={0.8}>
          <Text style={styles.skipText}>Stuck? Tap to open login</Text>
        </TouchableOpacity>
      )}
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  label: {
    marginTop: 12,
    fontSize: 16,
    color: colors.textSecondary,
  },
  skip: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 14,
    color: colors.primary,
  },
});
