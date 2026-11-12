import { useEffect, useRef } from 'react';
import { StyleSheet, Platform, View, Text, LogBox, AppState, AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import Constants from 'expo-constants';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../stores/authStore';
import { ErrorBoundary } from '../components/ErrorBoundary';
import NotificationFeedbackListener from '../components/NotificationFeedbackListener';
import { isSupabaseConfigured, startForegroundRefresh, awaitForegroundRefresh, testSupabaseConnection } from '../lib/supabase';
import { notifyAfterSessionRefreshed } from '../lib/onSessionRefreshed';
import { registerPushToken } from '../lib/pushNotifications';
import { ensureAndroidNotificationChannel } from '../lib/notificationChannel';
import { isOtaUpdatesEnabled, prefetchAppUpdateOnResume, syncAppUpdateOnLaunch } from '../lib/appUpdates';
import { captureLaunchDeepLink } from '../lib/captureLaunchDeepLink';
import { hydratePendingBadgeToken, peekPendingBadgeToken } from '../lib/pendingBadgeUrl';
import { hydratePendingPasswordRecoveryUrl, peekPendingPasswordRecoveryUrl } from '../lib/pendingRecoveryUrl';

import { initSentry, Sentry } from '../lib/sentry';

SplashScreen.preventAutoHideAsync().catch(() => {});
initSentry();
// Capture QR / deep-link URL before OTA/auth so we don't lose it on cold start.
void captureLaunchDeepLink();
void hydratePendingBadgeToken();
// Failsafe only — keep the native splash until index navigates (avoids logo → Loading → Stuck).
setTimeout(() => {
  SplashScreen.hideAsync().catch(() => {});
}, 8000);

// Suppress known harmless Expo Go/Android noise (keep-awake during camera/media; Metro may still log promise rejections).
LogBox.ignoreLogs(['Unable to activate keep awake', 'Uncaught (in promise']);

function setupPushNotifications() {
  if (Constants.appOwnership === 'expo' || Platform.OS === 'web') return;
  const Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldAnnounce: true,
      shouldShowBanner: true,
      shouldShowList: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
    }),
  });
  void ensureAndroidNotificationChannel();
}

setupPushNotifications();

function RootLayout() {
  const { initialize } = useAuthStore();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Native splash stays up until app/index navigates (or the 8s failsafe above).
  // Do not hide early on isLoading — that caused logo → white Loading → Stuck.

  // OTA on launch. Recovery URLs are persisted to storage so an update reload does not lose the link.
  useEffect(() => {
    if (!isOtaUpdatesEnabled()) return;
    let cancelled = false;
    void (async () => {
      await Promise.all([
        captureLaunchDeepLink(),
        hydratePendingPasswordRecoveryUrl(),
        hydratePendingBadgeToken(),
      ]);
      if (cancelled) return;
      // Don't block or reload during badge QR / password-reset cold starts.
      if (peekPendingBadgeToken() || peekPendingPasswordRecoveryUrl()) return;
      await syncAppUpdateOnLaunch();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh after a real background period. Camera and permission screens cause
  // brief inactive/background transitions; treating those as a full resume used
  // to cancel the photo upload and start every screen refetch at once.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = state;
      if (state === 'background') {
        backgroundedAtRef.current = Date.now();
      }
      if (state === 'active') {
        const backgroundedAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        const backgroundDurationMs =
          backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
        const resumedAfterMeaningfulBackground =
          prev === 'background' && backgroundDurationMs >= 15_000;
        if (!resumedAfterMeaningfulBackground) return;

        void prefetchAppUpdateOnResume();
        const uid = useAuthStore.getState().session?.user?.id;
        if (uid && Constants.appOwnership !== 'expo') {
          registerPushToken(uid).catch(() => {});
        }
        startForegroundRefresh();
        awaitForegroundRefresh().then(() => {
          notifyAfterSessionRefreshed();
        }).catch(() => {
          notifyAfterSessionRefreshed();
        });
        if (__DEV__ && isSupabaseConfigured) {
          setTimeout(() => {
            testSupabaseConnection().then(({ ok, message }) => {
              if (ok) console.log('[Supabase] Reachable after resume:', message);
              else console.warn('[Supabase] Not reachable after resume:', message);
            });
          }, 2000);
        }
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    void ensureAndroidNotificationChannel();
  }, []);

  const isExpoGo = Constants.appOwnership === 'expo';
  if (isExpoGo && !isSupabaseConfigured) {
    SplashScreen.hideAsync().catch(() => {});
    return (
      <View style={styles.expoGoConfigScreen}>
        <Text style={styles.expoGoConfigTitle}>Expo Go: Supabase not loaded</Text>
        <Text style={styles.expoGoConfigSubtitle}>
          The app bundle doesn't have your Supabase URL. Built iOS/Android work because they're built with env; Expo Go loads a bundle from your computer.
        </Text>
        <Text style={styles.expoGoConfigSteps}>
          1. Stop the Expo server (Ctrl+C){'\n'}
          2. In terminal, go to project root{'\n'}
          3. Run: npx expo start --clear{'\n'}
          4. Reload this app in Expo Go
        </Text>
        <Text style={styles.expoGoConfigNote}>Ensure .env has EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY. See EXPO-GO-SETUP.md.</Text>
        <Text style={[styles.expoGoConfigNote, { marginTop: 8 }]}>Phone and computer on same Wi‑Fi, or run: npx expo start --clear --tunnel</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <StatusBar style="dark" />
          <Toast />
          <NotificationFeedbackListener />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="badge" options={{ animation: 'fade' }} />
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen
              name="post"
              options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
            />
          </Stack>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  expoGoConfigScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  expoGoConfigTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  expoGoConfigSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    textAlign: 'center',
  },
  expoGoConfigSteps: {
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 16,
    textAlign: 'left',
  },
  expoGoConfigNote: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
    textAlign: 'center',
  },
});

export default Sentry.wrap(RootLayout);
