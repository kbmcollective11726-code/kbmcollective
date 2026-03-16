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
import { useDeepLink } from '../lib/useDeepLink';
import { supabase, isSupabaseConfigured, startForegroundRefresh } from '../lib/supabase';

SplashScreen.preventAutoHideAsync();

// Suppress known harmless Expo Go/Android error from expo-keep-awake (e.g. during camera/upload).
LogBox.ignoreLogs(['Unable to activate keep awake']);

// Channel ID must match Edge Functions (send-announcement-push, notify-event-starting-soon, process-scheduled-announcements).
// Use _v2 so devices get a fresh channel with sound+vibration (Android doesn't allow changing these after first create).
export const NOTIFICATION_CHANNEL_ID = 'collectivelive_notifications_v2';

function setupPushNotifications() {
  if (Constants.appOwnership === 'expo') return;
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
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'Notifications',
      description: 'Likes, comments, and announcements',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      enableVibrate: true,
      sound: 'default',
      enableLights: true,
      lightColor: '#2563eb',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
      showBadge: true,
    }).catch(() => {});
  }
}

setupPushNotifications();

const SPLASH_HIDE_MAX_MS = 500;

export default function RootLayout() {
  const { initialize, isLoading } = useAuthStore();
  const splashHidden = useRef(false);
  useDeepLink();

  useEffect(() => {
    initialize();
  }, [initialize]);

  // When app returns from background: start one shared refresh so Profile/Notifications/Groups can wait for it then load.
  const { user } = useAuthStore();
  useEffect(() => {
    if (!user?.id) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') startForegroundRefresh();
    });
    return () => sub.remove();
  }, [user?.id]);

  // Ensure Android notification channel exists after mount (sound + vibration).
  useEffect(() => {
    if (Constants.appOwnership === 'expo' || Platform.OS !== 'android') return;
    const Notifications = require('expo-notifications');
    Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: 'Notifications',
      description: 'Likes, comments, and announcements',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      enableVibrate: true,
      sound: 'default',
      enableLights: true,
      lightColor: '#2563eb',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
      showBadge: true,
    }).catch(() => {});
  }, []);

  // Hide splash quickly so we never get stuck on white/blue in Expo Go
  useEffect(() => {
    const hide = () => {
      if (splashHidden.current) return;
      splashHidden.current = true;
      SplashScreen.hideAsync().catch(() => {});
    };
    if (!isLoading) {
      hide();
      return;
    }
    const t = setTimeout(hide, SPLASH_HIDE_MAX_MS);
    return () => clearTimeout(t);
  }, [isLoading]);

  // Expo Go only: if Supabase URL wasn't loaded into the bundle, pages will never load. Show clear message.
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
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="post" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
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
