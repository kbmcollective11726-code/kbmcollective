import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthStore } from '../stores/authStore';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useDeepLink } from '../lib/useDeepLink';

SplashScreen.preventAutoHideAsync();

const SPLASH_HIDE_MAX_MS = 2500;

export default function RootLayout() {
  const { initialize, isLoading } = useAuthStore();
  const splashHidden = useRef(false);
  useDeepLink();

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Hide splash as soon as auth is ready, OR after max delay so we never stay on white screen
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

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <StatusBar style="auto" />
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
});
