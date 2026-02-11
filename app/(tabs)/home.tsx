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
  ImageBackground,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useEventStore } from '../../stores/eventStore';
import { supabase } from '../../lib/supabase';
import { useMemo } from 'react';
import { format } from 'date-fns';
import { useRouter } from 'expo-router';
import { Calendar, MapPin } from 'lucide-react-native';
import { colors } from '../../constants/colors';
import { theme } from '../../constants/theme';
import type { Event } from '../../lib/types';
import { getNowNextSessions, formatSessionTime, type SessionForNowNext } from '../../lib/scheduleNowNext';
import type { ScheduleSession } from '../../lib/types';

type PointRuleDisplay = { action: string; points_value: number; description: string | null };
const DISPLAY_ACTIONS = [
  { action: 'post_photo', label: 'Post a Photo' },
  { action: 'comment', label: 'Comment' },
  { action: 'give_like', label: 'Like Posts' },
] as const;
const ACTION_LABEL: Record<string, string> = Object.fromEntries(DISPLAY_ACTIONS.map((a) => [a.action, a.label]));

// Single-accent gradient (primary → primaryDark) for welcome banner
const HERO_GRADIENT_DEFAULT = [colors.primary, colors.primaryDark] as const;

function parseWhatToExpect(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((x) => typeof x === 'string');
  return [];
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    currentEvent,
    memberships,
    searchedEvent,
    isLoading,
    error: eventsError,
    fetchEventByCode,
    fetchMyMemberships,
    setCurrentEvent,
    setSearchedEvent,
    joinEvent,
    refresh,
  } = useEventStore();
  const [codeInput, setCodeInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pointRules, setPointRules] = useState<PointRuleDisplay[]>([]);
  const [scheduleSessions, setScheduleSessions] = useState<ScheduleSession[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    fetchMyMemberships(user.id);
  }, [user?.id]);

  // Fetch point rules for current event so Info page shows actual values
  useEffect(() => {
    if (!currentEvent?.id) {
      setPointRules([]);
      return;
    }
    let cancelled = false;
    fetchPointRules(currentEvent.id).then((rules) => {
      if (!cancelled) setPointRules(rules);
    });
    return () => { cancelled = true; };
  }, [currentEvent?.id]);

  // Fetch schedule for "Now & next" block
  useEffect(() => {
    if (!currentEvent?.id) {
      setScheduleSessions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('schedule_sessions')
        .select('id, title, start_time, end_time, day_number')
        .eq('event_id', currentEvent.id)
        .eq('is_active', true)
        .order('day_number', { ascending: true })
        .order('start_time', { ascending: true });
      if (!cancelled && !error) setScheduleSessions((data ?? []) as ScheduleSession[]);
    })();
    return () => { cancelled = true; };
  }, [currentEvent?.id]);

  const fetchPointRules = async (eventId: string) => {
    const { data, error } = await supabase
      .from('point_rules')
      .select('action, points_value, description')
      .eq('event_id', eventId)
      .in('action', DISPLAY_ACTIONS.map((a) => a.action));
    if (error || !data) return [];
    const rulesMap = new Map((data as PointRuleDisplay[]).map((r) => [r.action, r]));
    const ordered = DISPLAY_ACTIONS.map((a) => {
      const r = rulesMap.get(a.action);
      return r ?? { action: a.action, points_value: 0, description: a.label };
    }).filter((r) => r.points_value > 0);
    return ordered.length > 0 ? ordered : DISPLAY_ACTIONS.map((a) => ({
      action: a.action,
      points_value: 0,
      description: a.label,
    }));
  };

  const { nowSessions, nextSessions } = useMemo(
    () => getNowNextSessions(scheduleSessions as unknown as SessionForNowNext[], currentEvent?.start_date ?? null),
    [scheduleSessions, currentEvent?.start_date]
  );

  const onRefresh = async () => {
    if (!user?.id) return;
    setRefreshing(true);
    await refresh(user.id);
    if (currentEvent?.id) {
      const [rules, { data: sessions }] = await Promise.all([
        fetchPointRules(currentEvent.id),
        supabase.from('schedule_sessions').select('id, title, start_time, end_time, day_number').eq('event_id', currentEvent.id).eq('is_active', true).order('day_number').order('start_time'),
      ]);
      setPointRules(rules);
      setScheduleSessions((sessions ?? []) as ScheduleSession[]);
    }
    setRefreshing(false);
  };

  const handleSearchCode = async () => {
    setJoinError(null);
    setSearching(true);
    const { event, error } = await fetchEventByCode(codeInput);
    setSearching(false);
    if (error) setJoinError(error);
  };

  const isAlreadyMember = searchedEvent ? memberships.some((m) => m.event_id === searchedEvent.id) : false;

  const handleJoin = async () => {
    if (!user?.id || !searchedEvent) return;
    setJoinError(null);
    setSearching(true);
    // If already a member, just switch to this event (no insert)
    if (isAlreadyMember) {
      await setCurrentEvent(searchedEvent);
      setSearchedEvent(null);
      setSearching(false);
      return;
    }
    const { error } = await joinEvent(searchedEvent.id, user.id);
    setSearching(false);
    if (error) setJoinError(error);
  };

  const handleChangeEvent = () => {
    setCurrentEvent(null);
    setSearchedEvent(null);
    setCodeInput('');
    setJoinError(null);
  };

  const formatDate = (d: string) => {
    if (!d) return '';
    try {
      const parts = d.split('-').map(Number);
      if (parts.length !== 3 || parts.some(isNaN)) return d;
      const [year, month, day] = parts;
      const date = new Date(year, month - 1, day);
      return format(date, 'MMM d, yyyy'); // date-fns format
    } catch {
      return d;
    }
  };

  const openMapForLocation = (event: Event) => {
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
  };

  // No current event: show join-by-code UI
  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={80}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
          >
            <LinearGradient colors={[...HERO_GRADIENT_DEFAULT]} style={styles.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              <Text style={styles.heroTitle}>Welcome, {user?.full_name ?? 'there'}!</Text>
              <Text style={styles.heroSubtitle}>Enter your event code to join and get started.</Text>
            </LinearGradient>

            {eventsError ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{eventsError}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => fetchMyMemberships(user?.id ?? '')}>
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
                maxLength={10}
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
                  <TouchableOpacity onPress={() => openMapForLocation(searchedEvent)} activeOpacity={0.7}>
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
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Current event: summit-style info page
  const e = currentEvent;
  const themeColor = e.theme_color || colors.primary;
  const welcomeTitle = e.welcome_title?.trim() || `Welcome to ${e.name}!`;
  const welcomeSubtitle = e.welcome_subtitle?.trim() || 'Join us for an incredible journey of learning, networking, and growth!';
  const heroStat1 = e.hero_stat_1?.trim() || `${e.start_date && e.end_date ? 'Multi-day' : '1 Day'} of Excellence`;
  const heroStat2 = e.hero_stat_2?.trim() || 'Sessions & Speakers';
  const heroStat3 = e.hero_stat_3?.trim() || 'Unlimited Networking';
  const whatToExpect = parseWhatToExpect(e.what_to_expect);
  if (whatToExpect.length === 0) {
    whatToExpect.push(
      'View the agenda and live schedule updates',
      'Share photos and earn points',
      'Connect with attendees',
      'Climb the leaderboard'
    );
  }
  const pointsIntro = e.points_section_intro?.trim() || 'Participate actively and climb the leaderboard!';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[themeColor]} />
        }
      >
        {/* Banner — full-bleed image only (no text overlay), Guidebook-style */}
        {e.banner_url ? (
          <View style={styles.bannerWrap}>
            <ImageBackground
              source={{ uri: e.banner_url }}
              style={styles.bannerImage}
              imageStyle={styles.bannerImageStyle}
            />
          </View>
        ) : (
          <View style={styles.bannerWrap}>
            <LinearGradient
              colors={[themeColor, colors.primaryDark]}
              style={styles.bannerGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            />
          </View>
        )}

        {/* Event title & location below banner (Guidebook-style) */}
        <View style={styles.eventIntro}>
          <Text style={styles.eventIntroTitle}>{welcomeTitle}</Text>
          {(e.location || e.venue || e.map_url) ? (
            <>
              {e.location ? (
                <TouchableOpacity
                  onPress={() => openMapForLocation(e)}
                  activeOpacity={0.7}
                  style={styles.eventIntroAddressWrap}
                >
                  <Text style={styles.eventIntroAddress}>{e.location}</Text>
                </TouchableOpacity>
              ) : null}
              {e.venue ? (
                <TouchableOpacity
                  style={styles.eventIntroLocationRow}
                  onPress={() => openMapForLocation(e)}
                  activeOpacity={0.7}
                >
                  <MapPin size={16} color={colors.primary} />
                  <Text style={styles.eventIntroLocationLabel}>{e.venue}</Text>
                </TouchableOpacity>
              ) : e.location ? null : (
                <TouchableOpacity
                  style={styles.eventIntroLocationRow}
                  onPress={() => openMapForLocation(e)}
                  activeOpacity={0.7}
                >
                  <MapPin size={16} color={colors.primary} />
                  <Text style={styles.eventIntroLocationLabel}>Open in maps</Text>
                </TouchableOpacity>
              )}
            </>
          ) : null}
          <View style={styles.eventIntroStats}>
            <Text style={styles.eventIntroStatText}>{heroStat1}</Text>
            <Text style={styles.eventIntroStatDot}> · </Text>
            <Text style={styles.eventIntroStatText}>{heroStat2}</Text>
            <Text style={styles.eventIntroStatDot}> · </Text>
            <Text style={styles.eventIntroStatText}>{heroStat3}</Text>
          </View>
        </View>

        {/* Now & next — compact, tappable to Agenda */}
        {(nowSessions.length > 0 || nextSessions.length > 0) ? (
          <TouchableOpacity
            style={styles.nowNextCard}
            onPress={() => router.push('/(tabs)/schedule' as any)}
            activeOpacity={0.8}
          >
            <View style={styles.nowNextHeader}>
              <Calendar size={18} color={colors.primary} />
              <Text style={styles.nowNextTitle}>Schedule</Text>
            </View>
            {nowSessions.length > 0 ? (
              <View style={styles.nowNextRow}>
                <View style={styles.liveDot} />
                <Text style={styles.nowNextNowLabel}>Now:</Text>
                <Text style={styles.nowNextText} numberOfLines={1}>{nowSessions[0].title}</Text>
              </View>
            ) : null}
            {nextSessions.length > 0 ? (
              <View style={styles.nowNextRow}>
                <Text style={styles.nowNextNextLabel}>Next:</Text>
                <Text style={styles.nowNextText} numberOfLines={1}>{nextSessions[0].title}</Text>
                <Text style={styles.nowNextTime}>{formatSessionTime(nextSessions[0].start_time)}</Text>
              </View>
            ) : nowSessions.length === 0 ? (
              <Text style={styles.nowNextEmpty}>No more sessions today</Text>
            ) : null}
            <Text style={styles.nowNextTap}>Tap to view full agenda</Text>
          </TouchableOpacity>
        ) : null}

        {/* Event Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Event Details</Text>
          {e.arrival_day_text ? (
            <Text style={styles.detailRow}><Text style={styles.detailLabel}>Arrival Day:</Text> {e.arrival_day_text}</Text>
          ) : null}
          {e.summit_days_text ? (
            <Text style={styles.detailRow}><Text style={styles.detailLabel}>Summit Days:</Text> {e.summit_days_text}</Text>
          ) : (e.start_date || e.end_date) ? (
            <Text style={styles.detailRow}>
              <Text style={styles.detailLabel}>Dates:</Text> {formatDate(e.start_date)}{e.start_date && e.end_date ? ' – ' : ''}{formatDate(e.end_date)}
            </Text>
          ) : null}
          {(e.location || e.venue || e.map_url) ? (
            <TouchableOpacity
              style={styles.detailRowTouchable}
              onPress={() => openMapForLocation(e)}
              activeOpacity={0.7}
            >
              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>Location: </Text>
                <Text style={styles.detailValue}>{[e.location, e.venue].filter(Boolean).join(' · ') || 'Open map'}</Text>
                <Text style={styles.mapHint}> · Tap to open in maps</Text>
              </Text>
            </TouchableOpacity>
          ) : null}
          {e.theme_text ? (
            <Text style={styles.detailRow}><Text style={styles.detailLabel}>Theme:</Text> {e.theme_text}</Text>
          ) : null}
        </View>

        {/* What to Expect */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What to Expect</Text>
          {whatToExpect.map((line, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bulletText}>{line}</Text>
            </View>
          ))}
        </View>

        {/* Earn Points — same accent as banner */}
        <LinearGradient
          colors={[themeColor, colors.primaryDark]}
          style={styles.pointsSection}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <Text style={styles.pointsTitle}>Earn Points & Win Prizes</Text>
          <Text style={styles.pointsSubtitle}>{pointsIntro}</Text>
          <View style={styles.pointsRow}>
            {(pointRules.length > 0 ? pointRules : DISPLAY_ACTIONS.map((a) => ({
              action: a.action,
              points_value: 0,
              description: a.label,
            }))).slice(0, 3).map((rule) => (
              <View key={rule.action} style={styles.pointsBox}>
                <Text style={styles.pointsBoxText}>{rule.points_value} pts</Text>
                <Text style={styles.pointsBoxLabel}>{rule.description?.trim() || ACTION_LABEL[rule.action] || rule.action.replace(/_/g, ' ')}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.pointsDisclaimer}>*You can't earn points from your own posts!</Text>
        </LinearGradient>

        {/* How to Use This App */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How to Use This App</Text>
          <Text style={styles.howToRow}><Text style={styles.howToBold}>Info:</Text> Event details and welcome (you are here!)</Text>
          <Text style={styles.howToRow}><Text style={styles.howToBold}>Agenda:</Text> View the full schedule</Text>
          <Text style={styles.howToRow}><Text style={styles.howToBold}>Feed:</Text> Share photos and engage to earn points</Text>
          <Text style={styles.howToRow}><Text style={styles.howToBold}>Rank:</Text> See who's winning!</Text>
          <Text style={styles.howToRow}><Text style={styles.howToBold}>Community:</Text> Network with fellow attendees</Text>
          <Text style={styles.howToRow}><Text style={styles.howToBold}>Profile:</Text> Edit profile, notifications, DMs</Text>
        </View>

        <TouchableOpacity style={styles.changeEventBtn} onPress={handleChangeEvent}>
          <Text style={styles.changeEventText}>Change event</Text>
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  // Full-bleed banner (Guidebook-style: image only, no text overlay)
  bannerWrap: {
    marginHorizontal: -theme.spacing.lg,
    marginBottom: theme.spacing.xl,
  },
  bannerImage: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  bannerImageStyle: {},
  bannerGradient: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  eventIntro: {
    marginBottom: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  eventIntroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
    letterSpacing: 0.2,
  },
  eventIntroAddressWrap: { marginBottom: theme.spacing.xs },
  eventIntroAddress: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  eventIntroLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
    gap: 6,
  },
  eventIntroLocationLabel: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  eventIntroStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: theme.spacing.xs,
  },
  eventIntroStatText: { fontSize: 13, color: colors.textMuted },
  eventIntroStatDot: { fontSize: 13, color: colors.textMuted },
  // Join-event screen (no current event) still uses gradient + text
  hero: {
    borderRadius: theme.heroRadius,
    paddingVertical: theme.heroPaddingVertical,
    paddingHorizontal: theme.heroPaddingHorizontal,
    marginBottom: theme.spacing.lg,
    overflow: 'hidden',
  },
  heroTitle: {
    fontSize: theme.heroTitleSize,
    fontWeight: '700',
    color: colors.textOnPrimary,
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
  statRow: {
    flexDirection: 'row',
    gap: theme.heroStatGap,
    flexWrap: 'wrap',
  },
  statBox: {
    flex: 1,
    minWidth: 96,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: theme.heroStatRadius,
    padding: theme.heroStatPadding,
    ...theme.cardShadow,
  },
  statText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
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
  cardTextLink: { fontSize: 14, color: colors.primary, marginBottom: 4 },
  errorCard: {
    backgroundColor: colors.dangerLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: { fontSize: 14, color: colors.danger, fontWeight: '600', marginBottom: 8 },
  retryBtn: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 16, backgroundColor: colors.danger, borderRadius: 8 },
  retryBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  linkBtn: { alignSelf: 'center', paddingVertical: 12 },
  linkBtnText: { fontSize: 14, color: colors.primary, fontWeight: '500' },
  nowNextCard: {
    backgroundColor: theme.cardBackground,
    borderRadius: theme.sectionRadius,
    padding: theme.sectionPadding,
    marginBottom: theme.sectionMarginBottom,
    borderWidth: 1,
    borderColor: colors.border,
    ...theme.cardShadow,
  },
  nowNextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  nowNextTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  nowNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success ?? '#22c55e',
  },
  nowNextNowLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.success ?? '#22c55e',
  },
  nowNextNextLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    width: 32,
  },
  nowNextText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    minWidth: 0,
  },
  nowNextTime: {
    fontSize: 12,
    color: colors.textMuted,
  },
  nowNextEmpty: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginBottom: 4,
  },
  nowNextTap: {
    fontSize: 12,
    color: colors.primary,
    marginTop: 4,
    fontWeight: '500',
  },
  section: {
    backgroundColor: theme.cardBackground,
    borderRadius: theme.sectionRadius,
    padding: theme.sectionPadding,
    marginBottom: theme.sectionMarginBottom,
    ...theme.cardShadow,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: theme.spacing.sm, letterSpacing: 0.2 },
  detailRow: { fontSize: 14, color: colors.textSecondary, marginBottom: 6 },
  detailRowTouchable: { marginBottom: 6 },
  detailLabel: { fontWeight: '600', color: colors.text },
  detailValue: { color: colors.textSecondary },
  mapHint: { fontSize: 13, color: colors.primary },
  bulletRow: { flexDirection: 'row', marginBottom: 6 },
  bullet: { marginRight: 8, fontSize: 14, color: colors.primary },
  bulletText: { flex: 1, fontSize: 14, color: colors.textSecondary },
  pointsSection: {
    borderRadius: theme.heroRadius,
    padding: theme.heroPaddingHorizontal,
    marginBottom: theme.cardMarginBottom,
    overflow: 'hidden',
  },
  pointsTitle: { fontSize: 18, fontWeight: '700', color: colors.textOnPrimary, marginBottom: 4, letterSpacing: 0.2 },
  pointsSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.92)', marginBottom: theme.spacing.md, lineHeight: 20 },
  pointsRow: { flexDirection: 'row', gap: theme.heroStatGap },
  pointsBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: theme.heroStatRadius,
    padding: theme.heroStatPadding,
    alignItems: 'center',
    ...theme.cardShadow,
  },
  pointsBoxText: { fontSize: 16, fontWeight: '700', color: colors.text },
  pointsBoxLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  pointsDisclaimer: { fontSize: 11, color: 'rgba(255,255,255,0.88)', marginTop: theme.spacing.sm },
  howToRow: { fontSize: 14, color: colors.textSecondary, marginBottom: 6 },
  howToBold: { fontWeight: '600', color: colors.text },
  changeEventBtn: { alignSelf: 'center', paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  changeEventText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
});
