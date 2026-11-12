import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../stores/authStore';
import { colors } from '../constants/colors';
import { safeRouterReplace } from '../lib/safeNavigate';
import { hydratePendingBadgeToken, peekPendingBadgeToken } from '../lib/pendingBadgeUrl';
import { hydratePendingPasswordRecoveryUrl, peekPendingPasswordRecoveryUrl } from '../lib/pendingRecoveryUrl';
import { captureLaunchDeepLink } from '../lib/captureLaunchDeepLink';
import { markPlatformAdminAllEventsLanding, PLATFORM_ADMIN_ALL_EVENTS_HREF } from '../lib/platformAdminNav';
import DeepLinkHandler from '../components/DeepLinkHandler';
import StartupSplash from '../components/StartupSplash';

export default function IndexScreen() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const navigationReady = !!rootNavigationState?.key;
  const { isAuthenticated, isLoading, user, session } = useAuthStore();
  const mustChangePassword = !!session?.user?.user_metadata?.must_change_password;
  const navigated = useRef(false);
  const [showSkip, setShowSkip] = useState(false);
  const [launchReady, setLaunchReady] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [skipIntro, setSkipIntro] = useState(false);

  const hideSplash = async () => {
    try {
      await SplashScreen.hideAsync();
    } catch {
      /* ignore */
    }
    setSplashGone(true);
  };

  const leaveTo = async (href: string) => {
    if (navigated.current) return;
    navigated.current = true;
    // Tabs hides the native splash once its first real screen is ready (no dark gap on cold open).
    if (href.startsWith('/(tabs)')) {
      safeRouterReplace(router, href as never);
      return;
    }
    await hideSplash();
    safeRouterReplace(router, href as never);
  };

  useEffect(() => {
    void hideSplash();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      captureLaunchDeepLink(),
      hydratePendingPasswordRecoveryUrl(),
      hydratePendingBadgeToken(),
    ]).finally(() => {
      if (cancelled) return;
      if (peekPendingBadgeToken() || peekPendingPasswordRecoveryUrl()) {
        setSkipIntro(true);
      }
      setLaunchReady(true);
    });
    const t = setTimeout(() => {
      if (!cancelled) setLaunchReady(true);
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  // Only show Stuck after a real hang — not during normal auth restore.
  useEffect(() => {
    const t = setTimeout(() => setShowSkip(true), 5000);
    return () => clearTimeout(t);
  }, []);

  // Navigate as soon as auth + launch URL capture are known.
  useEffect(() => {
    if (!navigationReady) return;
    if (isLoading) return;
    if (!launchReady) return;
    if (!introDone && !skipIntro) return;
    if (navigated.current) return;

    // Password reset email link — must land on reset-password, not login.
    if (peekPendingPasswordRecoveryUrl()) {
      void leaveTo('/(auth)/reset-password');
      return;
    }

    // Badge QR cold start — enter tabs/login shell; DeepLinkHandler opens badge-scan once auth is ready.
    if (peekPendingBadgeToken()) {
      if (isAuthenticated) {
        if (mustChangePassword) {
          void leaveTo('/(auth)/change-password');
        } else {
          void leaveTo('/(tabs)/home');
        }
      } else {
        void leaveTo('/(auth)/login');
      }
      return;
    }

    if (isAuthenticated) {
      if (mustChangePassword) {
        void leaveTo('/(auth)/change-password');
      } else if (user?.is_platform_admin) {
        markPlatformAdminAllEventsLanding();
        void leaveTo(PLATFORM_ADMIN_ALL_EVENTS_HREF);
      } else {
        void leaveTo('/(tabs)/home');
      }
    } else {
      void leaveTo('/(auth)/login');
    }
  }, [
    isAuthenticated,
    isLoading,
    introDone,
    launchReady,
    mustChangePassword,
    skipIntro,
    user?.is_platform_admin,
    router,
    navigationReady,
  ]);

  // Safety: only after auth init finishes — never redirect while isLoading.
  useEffect(() => {
    if (!navigationReady) return;
    const t = setTimeout(() => {
      if (navigated.current) return;
      const { isLoading: loading, isAuthenticated: authed, user: authedUser } = useAuthStore.getState();
      if (loading) return;
      if (peekPendingPasswordRecoveryUrl()) {
        void leaveTo('/(auth)/reset-password');
        return;
      }
      if (!authed) {
        void leaveTo('/(auth)/login');
      } else if (authedUser?.is_platform_admin) {
        markPlatformAdminAllEventsLanding();
        void leaveTo(PLATFORM_ADMIN_ALL_EVENTS_HREF);
      } else {
        void leaveTo('/(tabs)/home');
      }
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
      void leaveTo('/(auth)/login');
    }, 25000);
    return () => clearTimeout(t);
  }, [router, navigationReady]);

  const goToLogin = () => {
    if (!navigationReady) return;
    void leaveTo('/(auth)/login');
  };

  // Hold the animated mark until we leave this screen. Expo Go can show it; the installed app still opens on the still logo first.
  if (!skipIntro) {
    return (
      <>
        <DeepLinkHandler />
        <StartupSplash
          play={splashGone}
          onDone={() => setIntroDone(true)}
          showSkip={showSkip}
          onSkip={() => {
            setIntroDone(true);
            goToLogin();
          }}
        />
      </>
    );
  }

  // While native splash is up, render black so a brief gap never flashes white Loading.
  if (!splashGone && !showSkip) {
    return (
      <>
        <DeepLinkHandler />
        <View style={styles.splashHold} />
      </>
    );
  }

  return (
    <>
      <DeepLinkHandler />
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.label}>Loading…</Text>
        {showSkip ? (
          <TouchableOpacity style={styles.skip} onPress={goToLogin} activeOpacity={0.8}>
            <Text style={styles.skipText}>Stuck? Tap to open login</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  splashHold: {
    flex: 1,
    backgroundColor: '#000000',
  },
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
