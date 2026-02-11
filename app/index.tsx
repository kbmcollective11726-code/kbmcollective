import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { colors } from '../constants/colors';

export default function IndexScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();
  const navigated = useRef(false);
  const [showSkip, setShowSkip] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowSkip(true), 2000);
    return () => clearTimeout(t);
  }, []);

  // Navigate as soon as auth state is known
  useEffect(() => {
    if (isLoading) return;
    if (navigated.current) return;
    navigated.current = true;

    if (isAuthenticated) {
      router.replace('/(tabs)/home');
    } else {
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Safety: if still on this screen after 4s, force go to login (avoids stuck white screen)
  useEffect(() => {
    const t = setTimeout(() => {
      if (navigated.current) return;
      navigated.current = true;
      router.replace('/(auth)/login');
    }, 4000);
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
