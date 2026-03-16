/**
 * Full-screen gate shown when user has no active/accessible event.
 * They see ONLY: welcome message, event code input, search button, and logout at bottom.
 * No menu, no tabs, no other navigation until they join an event.
 */
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../stores/authStore';
import { useEventStore } from '../stores/eventStore';
import { colors } from '../constants/colors';
import { LogOut, ChevronLeft } from 'lucide-react-native';
import { theme } from '../constants/theme';
import type { Event } from '../lib/types';

const HERO_GRADIENT = [colors.primary, colors.primaryDark] as const;

function formatDate(d: string) {
  if (!d) return '';
  try {
    const parts = d.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return d;
    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}

function openMap(event: Event) {
  const url = event.map_url?.trim();
  if (url) {
    Linking.openURL(url).catch(() => {});
    return;
  }
  const address = [event.location, event.venue].filter(Boolean).join(', ') || event.location || event.venue;
  if (!address) return;
  const encoded = encodeURIComponent(address);
  const mapUrl = Platform.OS === 'ios'
    ? `https://maps.apple.com/?q=${encoded}`
    : `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  Linking.openURL(mapUrl).catch(() => {});
}

export default function JoinEventGate() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const {
    memberships,
    searchedEvent,
    joiningByCode,
    error: eventsError,
    fetchEventByCode,
    fetchMyMemberships,
    setCurrentEvent,
    setSearchedEvent,
    joinEvent,
    refresh,
    cancelJoinByCode,
  } = useEventStore();
  const [codeInput, setCodeInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    fetchMyMemberships(user.id, user?.is_platform_admin);
  }, [user?.id, user?.is_platform_admin, fetchMyMemberships]);

  // Safety: if search/join is stuck (e.g. request never resolves on iOS), clear loading after 25s
  useEffect(() => {
    if (!searching) return;
    const t = setTimeout(() => setSearching(false), 25000);
    return () => clearTimeout(t);
  }, [searching]);

  const onRefresh = async () => {
    if (!user?.id) return;
    setRefreshing(true);
    await refresh(user.id, user?.is_platform_admin);
    setRefreshing(false);
  };

  const handleSearchCode = async () => {
    setJoinError(null);
    setSearching(true);
    try {
      const { error } = await fetchEventByCode(codeInput);
      if (error) setJoinError(error);
    } finally {
      setSearching(false);
    }
  };

  const isAlreadyMember = searchedEvent ? memberships.some((m: { event_id: string }) => m.event_id === searchedEvent.id) : false;

  const handleJoin = async () => {
    if (!user?.id || !searchedEvent) return;
    setJoinError(null);
    setSearching(true);
    try {
      if (isAlreadyMember) {
        await setCurrentEvent(searchedEvent);
        setSearchedEvent(null);
        return;
      }
      const { error } = await joinEvent(searchedEvent.id, user.id);
      if (error) setJoinError(error);
    } finally {
      setSearching(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  const handleBack = async () => {
    if (!user?.id) return;
    const route = await cancelJoinByCode(user.id, user?.is_platform_admin);
    if (route) router.replace(route as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        {joiningByCode ? (
          <View style={styles.backBar}>
            <TouchableOpacity style={styles.backBtn} onPress={handleBack} hitSlop={12} activeOpacity={0.7}>
              <ChevronLeft size={24} color={colors.primary} strokeWidth={2} />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
        >
          <LinearGradient colors={[...HERO_GRADIENT]} style={styles.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Text style={styles.heroTitle}>Welcome, {user?.full_name ?? 'there'}!</Text>
            <Text style={styles.heroSubtitle}>Enter your event code to join and get started.</Text>
          </LinearGradient>

          {eventsError ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{eventsError}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchMyMemberships(user?.id ?? '', user?.is_platform_admin)}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Event code</Text>
            <TextInput
              style={styles.codeInput}
              value={codeInput}
              onChangeText={(t) => {
                setCodeInput(t.toUpperCase());
                setJoinError(null);
                setSearchedEvent(null);
              }}
              placeholder="e.g. ABC123"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, searching && styles.btnDisabled]}
              onPress={handleSearchCode}
              disabled={searching || !codeInput.trim()}
            >
              {searching ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Search for event</Text>
              )}
            </TouchableOpacity>
            {joinError ? <Text style={styles.inlineError}>{joinError}</Text> : null}
          </View>

          {searchedEvent ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Event found</Text>
              {isAlreadyMember ? (
                <Text style={styles.alreadyMemberHint}>You're already in this event.</Text>
              ) : null}
              <Text style={styles.eventFoundName}>{searchedEvent.name}</Text>
              {(searchedEvent.location || searchedEvent.venue || searchedEvent.map_url) ? (
                <TouchableOpacity onPress={() => openMap(searchedEvent)} activeOpacity={0.7}>
                  <Text style={styles.cardTextLink}>📍 {[searchedEvent.location, searchedEvent.venue].filter(Boolean).join(' · ') || 'Tap to open map'}</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.cardText}>
                {formatDate(searchedEvent.start_date)} – {formatDate(searchedEvent.end_date)}
              </Text>
              <TouchableOpacity
                style={[styles.primaryBtn, styles.joinBtn, searching && styles.btnDisabled]}
                onPress={handleJoin}
                disabled={searching}
              >
                {searching ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>{isAlreadyMember ? 'Open event' : 'Join this event'}</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {memberships.length > 0 ? (
            <TouchableOpacity style={styles.linkBtn} onPress={onRefresh}>
              <Text style={styles.linkBtnText}>I already joined – refresh my event</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <TouchableOpacity style={styles.logoutBtnBottom} onPress={handleLogout} activeOpacity={0.7}>
            <LogOut size={20} color={colors.textSecondary} />
            <Text style={styles.logoutBtnBottomText}>Log out</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  backBar: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 12,
    paddingTop: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.background,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
  },
  backBtnText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.primary,
  },
  content: { padding: theme.spacing.lg, paddingBottom: 100 },
  hero: {
    borderRadius: theme.heroRadius,
    paddingVertical: theme.heroPaddingVertical,
    paddingHorizontal: theme.heroPaddingHorizontal,
    marginBottom: theme.spacing.lg,
    overflow: 'hidden',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 16,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutBtnBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  logoutBtnBottomText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  heroTitle: {
    fontSize: theme.heroTitleSize,
    fontWeight: '700',
    color: colors.textOnPrimary ?? '#fff',
    marginBottom: theme.spacing.xs,
    letterSpacing: 0.3,
    lineHeight: 30,
  },
  heroSubtitle: {
    fontSize: theme.heroSubtitleSize,
    color: 'rgba(255,255,255,0.92)',
    marginBottom: theme.spacing.md,
    lineHeight: 22,
  },
  errorCard: {
    backgroundColor: colors.surface,
    borderRadius: theme.cardRadius,
    padding: theme.cardPadding,
    marginBottom: theme.cardMarginBottom,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: { fontSize: 14, color: colors.danger, marginBottom: 8 },
  retryBtn: { alignSelf: 'flex-start' },
  retryBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  card: {
    backgroundColor: theme.cardBackground,
    borderRadius: theme.cardRadius,
    padding: theme.cardPadding,
    marginBottom: theme.cardMarginBottom,
    ...theme.cardShadow,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: theme.spacing.sm },
  codeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: theme.cardRadius,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 18,
    letterSpacing: 2,
    color: colors.text,
    marginBottom: theme.spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: theme.cardRadius,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  joinBtn: { marginTop: 8 },
  btnDisabled: { opacity: 0.7 },
  primaryBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  inlineError: { fontSize: 13, color: colors.danger, marginTop: 8 },
  alreadyMemberHint: { fontSize: 13, color: colors.secondary, marginBottom: 6, fontWeight: '500' },
  eventFoundName: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 6 },
  cardText: { fontSize: 14, color: colors.textSecondary, marginBottom: 4 },
  cardTextLink: { fontSize: 14, color: colors.primary, marginBottom: 6, fontWeight: '500' },
  linkBtn: { alignSelf: 'center', marginTop: 8 },
  linkBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
});
