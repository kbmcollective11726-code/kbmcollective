import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../../stores/authStore';
import { isSupabaseConfigured } from '../../lib/supabase';

const LOGO = require('../../assets/logo-full-transparent.png');

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuthStore();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const timeoutHandledRef = useRef(false);

  useEffect(() => {
    if (__DEV__) console.log('[Register] component did mount');
    return () => {
      if (__DEV__) console.log('[Register] component will unmount');
    };
  }, []);

  const handleRegister = async () => {
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedName || !trimmedEmail || !password) {
      Alert.alert('Missing fields', 'Please enter name, email, and password.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Weak password', 'Password must be at least 8 characters.');
      return;
    }
    if (!isSupabaseConfigured) {
      Alert.alert(
        'Not configured',
        'Supabase URL is missing. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env in the project root, then run: npx expo start --clear'
      );
      return;
    }
    setLoading(true);
    timeoutHandledRef.current = false;
    const timeoutId = setTimeout(() => {
      timeoutHandledRef.current = true;
      setLoading(false);
      Alert.alert(
        'Taking longer than usual',
        'Your account may still have been created. Try signing in with your email and password in a moment.',
        [{ text: 'OK' }]
      );
    }, 25000);
    if (__DEV__) console.log('[Register] calling register() with email:', trimmedEmail);
    const { error, needsEmailConfirmation } = await register(trimmedEmail, password, trimmedName);
    clearTimeout(timeoutId);
    if (timeoutHandledRef.current) return;
    setLoading(false);
    if (__DEV__) console.log('[Register] register() returned:', { error, needsEmailConfirmation });
    if (error) {
      if (__DEV__) console.log('[Register] registration failed — error:', error);
      Alert.alert('Registration failed', error);
      return;
    }
    const session = useAuthStore.getState().session;
    const user = useAuthStore.getState().user;
    if (__DEV__) console.log('[Register] after register — session:', session ? 'present' : 'null', 'user:', user ? 'present' : 'null');
    if (!session && !needsEmailConfirmation) {
      if (__DEV__) console.log('[Register] session is null or expired after successful register');
    }
    if (needsEmailConfirmation) {
      Alert.alert(
        'Check your email',
        'We sent a confirmation link to ' + trimmedEmail + '. Open it to activate your account, then sign in here.',
        [{ text: 'OK' }, { text: 'Sign in', onPress: () => router.replace('/(auth)/login') }]
      );
      return;
    }
    const sessionAfter = useAuthStore.getState().session;
    if (__DEV__) console.log('[Register] before redirect — session:', sessionAfter ? 'present' : 'null', 'expires_at:', sessionAfter?.expires_at ?? 'n/a');
    const mustChangePassword = !!sessionAfter?.user?.user_metadata?.must_change_password;
    if (mustChangePassword) {
      if (__DEV__) console.log('[Register] redirecting to change-password');
      router.replace('/(auth)/change-password');
    } else if (useAuthStore.getState().user?.is_platform_admin) {
      router.replace('/profile/admin-all-events');
    } else {
      router.replace('/(tabs)/home');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoWrap}>
            <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          </View>
          <Text style={styles.subtitle}>Create your account</Text>

          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor="#94a3b8"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#94a3b8"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Password (min 8 characters)"
            placeholderTextColor="#94a3b8"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password-new"
            editable={!loading}
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.buttonText}>Sign Up</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.link}
            onPress={() => router.back()}
            disabled={loading}
          >
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkBold}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  keyboard: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 0,
    paddingBottom: 24,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 0,
  },
  logo: {
    width: '100%',
    maxWidth: 380,
    height: 220,
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginBottom: 16,
    textAlign: 'center',
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#f8fafc',
    marginBottom: 16,
    backgroundColor: '#1a1a1a',
  },
  button: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#d4af37',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  link: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 14,
    color: '#94a3b8',
  },
  linkBold: {
    color: '#d4af37',
    fontWeight: '600',
  },
});
