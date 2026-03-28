import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { colors } from '../constants/colors';

export default function IndexScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading, user, session } = useAuthStore();
  const mustChangePassword = !!session?.user?.user_metadata?.must_change_password;
  const navigated = useRef(false);
  const [showSkip, setShowSkip] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowSkip(true), 1000);
    return () => clearTimeout(t);
  }, []);

  // Navigate as soon as auth state is known. Force password change first if required.
  useEffect(() => {
    if (isLoading) return;
    if (navigated.current) return;
    navigated.current = true;

    if (isAuthenticated) {
      if (mustChangePassword) {
        router.replace('/(auth)/change-password');
      } else if (user?.is_platform_admin) {
        router.replace('/profile/admin-all-events');
      } else {
        router.replace('/(tabs)/home');
      }
    } else {
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated, isLoading, mustChangePassword, user?.is_platform_admin, router]);

  // Safety: only after auth init finishes — never redirect while isLoading (slow getSession was
  // firing this at 1.5s and sending signed-in users to login = "random sign out" reports).
  useEffect(() => {
    const t = setTimeout(() => {
      if (navigated.current) return;
      const { isLoading: loading, isAuthenticated: authed } = useAuthStore.getState();
      if (loading) return;
      navigated.current = true;
      router.replace(authed ? '/(tabs)/home' : '/(auth)/login');
    }, 4000);
    return () => clearTimeout(t);
  }, [router]);

  // Last resort if initialize() never clears isLoading (very rare)
  useEffect(() => {
    const t = setTimeout(() => {
      if (navigated.current) return;
      const { isLoading: loading } = useAuthStore.getState();
      if (!loading) return;
      navigated.current = true;
      router.replace('/(auth)/login');
    }, 25000);
    return () => clearTimeout(t);
  }, [router]);

  const goToLogin = () => {
    if (navigated.current) return;
    navigated.current = true;
    router.replace('/(auth)/login');
  };

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.label}>Loading…</Text>
      {showSkip && (
        <TouchableOpacity style={styles.skip} onPress={goToLogin} activeOpacity={0.8}>
          <Text style={styles.skipText}>Stuck? Tap to open login</Text>
        </TouchableOpacity>
      )}
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
