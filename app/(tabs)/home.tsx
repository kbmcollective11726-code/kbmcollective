import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
  Modal,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/authStore';
import { useEventStore } from '../../stores/eventStore';
import { supabase } from '../../lib/supabase';
import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { useRouter, usePathname } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Calendar, MapPin, X, ChevronDown, ChevronUp, Home, ImageIcon, Trophy, Users, User, Store } from 'lucide-react-native';
import { colors } from '../../constants/colors';
import { theme } from '../../constants/theme';
import type { Event } from '../../lib/types';
import { isEventAccessible } from '../../lib/eventAccess';
import { withRefreshTimeout } from '../../lib/refreshWithTimeout';
import { getNowNextSessions, formatSessionTime, type SessionForNowNext } from '../../lib/scheduleNowNext';

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
  const pathname = usePathname();
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
    requestJoinByCode,
  } = useEventStore();
  const [codeInput, setCodeInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pointRules, setPointRules] = useState<PointRuleDisplay[]>([]);
  const [scheduleSessions, setScheduleSessions] = useState<SessionForNowNext[]>([]);
  const [nextB2B, setNextB2B] = useState<{ vendor_name: string; start_time: string; end_time: string; booth_id: string } | null>(null);
  const [announcements, setAnnouncements] = useState<{ id: string; title: string; content: string; created_at: string }[]>([]);
  const [dismissedAnnouncementIds, setDismissedAnnouncementIds] = useState<Set<string>>(new Set());
  const [announcementsSectionHidden, setAnnouncementsSectionHidden] = useState(false);
  const [eventSwitcherVisible, setEventSwitcherVisible] = useState(false);
  const [nowNextTick, setNowNextTick] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    fetchMyMemberships(user.id, user?.is_platform_admin);
  }, [user?.id, user?.is_platform_admin, fetchMyMemberships]);

  // Recompute "now & next" every minute so the highlighted session updates as time passes.
  useEffect(() => {
    const interval = setInterval(() => setNowNextTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Clear currentEvent if it's no longer accessible (ended > 5 days ago or inactive; super admin can keep disabled events)
  useEffect(() => {
    if (currentEvent && !isEventAccessible(currentEvent, user?.is_platform_admin)) {
      setCurrentEvent(null);
    }
  }, [currentEvent?.id, currentEvent?.end_date, currentEvent?.is_active, user?.is_platform_admin]);

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

  // Fetch schedule for current event only — sessions only show for the event they belong to
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
      if (cancelled || error) return;
      setScheduleSessions((data ?? []) as SessionForNowNext[]);
    })();
    return () => { cancelled = true; };
  }, [currentEvent?.id]);

  // Fetch next B2B meeting for this user (current event)
  const fetchNextB2B = useCallback(async () => {
    if (!currentEvent?.id || !user?.id) {
      setNextB2B(null);
      return;
    }
    try {
      const { data: myBookings } = await supabase
        .from('meeting_bookings')
        .select('slot_id, meeting_slots(booth_id, start_time, end_time)')
        .eq('attendee_id', user.id)
        .neq('status', 'cancelled');
      type Row = { slot_id: string; meeting_slots: { booth_id: string; start_time: string; end_time: string } | null };
      const rows = (myBookings ?? []) as unknown as Row[];
      const slots: { booth_id: string; start_time: string; end_time: string }[] = [];
      for (const r of rows) {
        const slot = r.meeting_slots;
        if (slot?.booth_id && slot.start_time && slot.end_time) slots.push(slot);
      }
      const nowMs = Date.now();
      const upcoming = slots
        .map((s) => {
          try {
            const startMs = parseISO(s.start_time.replace(' ', 'T')).getTime();
            return { ...s, startMs: Number.isNaN(startMs) ? 0 : startMs };
          } catch {
            return { ...s, startMs: 0 };
          }
        })
        .filter((s) => s.startMs > nowMs)
        .sort((a, b) => a.startMs - b.startMs);
      if (upcoming.length === 0) {
        setNextB2B(null);
        return;
      }
      const first = upcoming[0];
      const boothIds = [...new Set(slots.map((s) => s.booth_id))];
      const { data: boothData } = await supabase
        .from('vendor_booths')
        .select('id, vendor_name')
        .eq('event_id', currentEvent.id)
        .in('id', boothIds);
      const booth = (boothData ?? []).find((b: { id: string }) => b.id === first.booth_id) as { vendor_name: string } | undefined;
      setNextB2B({
        vendor_name: booth?.vendor_name ?? 'B2B meeting',
        start_time: first.start_time,
        end_time: first.end_time,
        booth_id: first.booth_id,
      });
    } catch {
      setNextB2B(null);
    }
  }, [currentEvent?.id, user?.id]);

  useEffect(() => {
    fetchNextB2B();
  }, [fetchNextB2B]);

  // Fetch announcements for current event
  useEffect(() => {
    if (!currentEvent?.id) {
      setAnnouncements([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, content, created_at')
        .eq('event_id', currentEvent.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (!cancelled && !error) setAnnouncements((data ?? []) as { id: string; title: string; content: string; created_at: string }[]);
    })();
    return () => { cancelled = true; };
  }, [currentEvent?.id]);

  // Load dismissed announcements & section hidden from AsyncStorage (per user, per event)
  useEffect(() => {
    if (!currentEvent?.id || !user?.id) {
      setDismissedAnnouncementIds(new Set());
      setAnnouncementsSectionHidden(false);
      return;
    }
    // Reset first so we don't briefly show previous event's prefs
    setDismissedAnnouncementIds(new Set());
    setAnnouncementsSectionHidden(false);
    const key = `collectivelive_announcements_${user.id}_${currentEvent.id}`;
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(key);
        if (cancelled || !stored) return;
        const parsed = JSON.parse(stored) as { dismissedIds?: string[]; sectionHidden?: boolean };
        if (parsed.dismissedIds?.length) setDismissedAnnouncementIds(new Set(parsed.dismissedIds));
        if (parsed.sectionHidden === true) setAnnouncementsSectionHidden(true);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [currentEvent?.id, user?.id]);

  const saveAnnouncementsPrefs = async (dismissed: Set<string>, hidden: boolean) => {
    if (!currentEvent?.id || !user?.id) return;
    const key = `collectivelive_announcements_${user.id}_${currentEvent.id}`;
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ dismissedIds: [...dismissed], sectionHidden: hidden })
    );
  };

  const handleDismissAnnouncement = async (id: string) => {
    const next = new Set(dismissedAnnouncementIds);
    next.add(id);
    setDismissedAnnouncementIds(next);
    await saveAnnouncementsPrefs(next, announcementsSectionHidden);
  };

  const handleToggleAnnouncementsSection = async () => {
    const next = !announcementsSectionHidden;
    setAnnouncementsSectionHidden(next);
    await saveAnnouncementsPrefs(dismissedAnnouncementIds, next);
  };

  const visibleAnnouncements = useMemo(
    () => announcements.filter((a) => !dismissedAnnouncementIds.has(a.id)),
    [announcements, dismissedAnnouncementIds]
  );

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
    () => getNowNextSessions(scheduleSessions, currentEvent?.start_date ?? null),
    [scheduleSessions, currentEvent?.start_date, nowNextTick]
  );

  const refetchInfoData = useCallback(async () => {
    if (!user?.id) return;
    await refresh(user.id, user?.is_platform_admin);
    if (currentEvent?.id) {
      const [rules, { data: sessions }, { data: ann }] = await Promise.all([
        fetchPointRules(currentEvent.id),
        supabase.from('schedule_sessions').select('id, title, start_time, end_time, day_number').eq('event_id', currentEvent.id).eq('is_active', true).order('day_number').order('start_time'),
        supabase.from('announcements').select('id, title, content, created_at').eq('event_id', currentEvent.id).order('created_at', { ascending: false }).limit(20),
      ]);
      setPointRules(rules);
      setScheduleSessions((sessions ?? []) as SessionForNowNext[]);
      setAnnouncements((ann ?? []) as { id: string; title: string; content: string; created_at: string }[]);
      fetchNextB2B();
    }
  }, [user?.id, currentEvent?.id, refresh, fetchNextB2B]);

  useFocusEffect(
    useCallback(() => {
      withRefreshTimeout(refetchInfoData()).catch(() => {});
    }, [refetchInfoData])
  );

  const onRefresh = async () => {
    if (!user?.id) return;
    setRefreshing(true);
    try {
      await withRefreshTimeout(refetchInfoData());
    } catch {
      // Timeout or error; spinner will stop in finally
    } finally {
      setRefreshing(false);
    }
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
    setEventSwitcherVisible(true);
  };

  const myEvents = useMemo(() => {
    const rows = memberships as Array<{ events?: Event | null }>;
    const events = (rows ?? []).map((m) => m.events).filter((e): e is Event => e != null && typeof e === 'object' && 'id' in e);
    return events.filter((e) => isEventAccessible(e, user?.is_platform_admin));
  }, [memberships, user?.is_platform_admin]);

  const handleSelectEventFromList = async (event: Event) => {
    await setCurrentEvent(event);
    setEventSwitcherVisible(false);
  };

  const handleJoinWithCode = () => {
    setEventSwitcherVisible(false);
    if (typeof requestJoinByCode === 'function') {
      requestJoinByCode(pathname ?? '/(tabs)/home');
    }
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

  // No current event or event ended > 5 days ago (or disabled for non–super admin): show join-by-code UI
  if (!currentEvent || !isEventAccessible(currentEvent, user?.is_platform_admin)) {
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
  let welcomeTitle =
    typeof e.welcome_title === 'string'
      ? e.welcome_title
      : e.welcome_title != null
        ? String(e.welcome_title)
        : '';
  welcomeTitle = welcomeTitle
    .replace(/\[object\s+Object\]/gi, '')
    .replace(/\bOBJ\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!welcomeTitle) welcomeTitle = `Welcome to ${e.name}!`;
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
              resizeMode="cover"
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
          <Text style={styles.eventIntroTitle}>{String(welcomeTitle)}</Text>
          {(e.venue || e.map_url) ? (
            <>
              {e.venue ? (
                <TouchableOpacity
                  style={styles.eventIntroLocationRow}
                  onPress={() => openMapForLocation(e)}
                  activeOpacity={0.7}
                >
                  <MapPin size={16} color={colors.primary} />
                  <Text style={styles.eventIntroVenue}>{e.venue}</Text>
                </TouchableOpacity>
              ) : e.map_url ? (
                <TouchableOpacity
                  style={styles.eventIntroLocationRow}
                  onPress={() => openMapForLocation(e)}
                  activeOpacity={0.7}
                >
                  <MapPin size={16} color={colors.primary} />
                  <Text style={styles.eventIntroLocationLabel}>Open in maps</Text>
                </TouchableOpacity>
              ) : null}
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

        {/* Now & next — compact, tappable to Agenda. Sessions only show for the current event. Next B2B shown when user has one. */}
        {(nowSessions.length > 0 || nextSessions.length > 0 || nextB2B) ? (
          <View style={styles.nowNextCard}>
            <TouchableOpacity
              style={styles.nowNextCardTouchable}
              onPress={() => router.push('/(tabs)/schedule' as any)}
              activeOpacity={0.8}
            >
              <View style={styles.nowNextHeader}>
                <Calendar size={18} color={colors.primary} />
                <Text style={styles.nowNextTitle}>Schedule</Text>
              </View>
              {nowSessions.length > 0 ? (
                nowSessions.length === 1 ? (
                  <View style={styles.nowNextRow}>
                    <View style={styles.liveDot} />
                    <Text style={styles.nowNextNowLabel}>Now:</Text>
                    <Text style={styles.nowNextText} numberOfLines={1}>{nowSessions[0].title}</Text>
                  </View>
                ) : (
                  nowSessions.map((session) => (
                    <View key={session.id} style={styles.nowNextRow}>
                      <View style={styles.liveDot} />
                      <Text style={styles.nowNextNowLabel}>Now:</Text>
                      <Text style={styles.nowNextText} numberOfLines={1}>{session.title}</Text>
                    </View>
                  ))
                )
              ) : null}
              {nextSessions.length > 0 ? (
                <View style={styles.nowNextRow}>
                  <Text style={styles.nowNextNextLabel}>Next:</Text>
                  <Text style={styles.nowNextText} numberOfLines={1}>{nextSessions[0].title}</Text>
                  <Text style={styles.nowNextTime}>{formatSessionTime(nextSessions[0].start_time)}</Text>
                </View>
              ) : nowSessions.length === 0 && !nextB2B ? (
                <Text style={styles.nowNextEmpty}>No more sessions today</Text>
              ) : null}
              {nextB2B ? (
                <TouchableOpacity
                  style={styles.nowNextRow}
                  onPress={() => router.push(`/(tabs)/expo/${nextB2B.booth_id}?from=${encodeURIComponent('/(tabs)/home')}` as any)}
                  activeOpacity={0.7}
                >
                  <Store size={14} color={colors.primary} style={{ marginRight: 6 }} />
                  <Text style={styles.nowNextNextLabel}>Next B2B:</Text>
                  <Text style={styles.nowNextText} numberOfLines={1}>{nextB2B.vendor_name}</Text>
                  <Text style={styles.nowNextTime}>{formatSessionTime(nextB2B.start_time)}</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.nowNextTap}>Tap to view full agenda</Text>
            </TouchableOpacity>
          </View>
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
          {(e.location || e.map_url) ? (
            <TouchableOpacity
              style={styles.detailRowTouchable}
              onPress={() => openMapForLocation(e)}
              activeOpacity={0.7}
            >
              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>Location: </Text>
                <Text style={styles.detailValue}>{e.location || 'Tap to open in maps'}</Text>
                <Text style={styles.mapHint}> · Tap to open in maps</Text>
              </Text>
            </TouchableOpacity>
          ) : null}
          {e.theme_text ? (
            <Text style={styles.detailRow}><Text style={styles.detailLabel}>Theme:</Text> {e.theme_text}</Text>
          ) : null}
        </View>

        {/* Announcements */}
        {announcements.length > 0 ? (
          announcementsSectionHidden ? (
            <TouchableOpacity style={[styles.announcementsCollapsed, styles.announcementsHasContent]} onPress={handleToggleAnnouncementsSection} activeOpacity={0.7}>
              <Text style={styles.announcementsCollapsedText}>Announcements</Text>
              <ChevronDown size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : (
            <View style={[styles.section, visibleAnnouncements.length > 0 && styles.announcementsHasContent]}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Announcements</Text>
                <View style={styles.announcementsHeaderActions}>
                  <TouchableOpacity onPress={() => router.push('/profile/announcements' as any)} hitSlop={12}>
                    <Text style={styles.seeAllLink}>See all</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleToggleAnnouncementsSection} hitSlop={12} style={styles.hideAnnouncementsBtn}>
                    <Text style={styles.hideAnnouncementsText}>Hide</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {visibleAnnouncements.slice(0, 5).map((a) => (
                <View key={a.id} style={styles.announcementCard}>
                  <View style={styles.announcementCardHeader}>
                    <Text style={styles.announcementTitle}>{String(a.title)}</Text>
                    <TouchableOpacity onPress={() => handleDismissAnnouncement(a.id)} hitSlop={12} style={styles.dismissAnnouncementBtn}>
                      <X size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.announcementContent} numberOfLines={2}>{String(a.content)}</Text>
                  <Text style={styles.announcementDate}>{format(new Date(a.created_at), 'MMM d, yyyy · h:mm a')}</Text>
                </View>
              ))}
              {visibleAnnouncements.length === 0 ? (
                <Text style={styles.noAnnouncementsHint}>No announcements visible. Dismissed items are hidden.</Text>
              ) : null}
            </View>
          )
        ) : null}

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
          <View style={styles.howToRow}>
            <View style={styles.howToIcon}>
              <Home size={20} color={colors.primary} />
            </View>
            <Text style={styles.howToText}><Text style={styles.howToBold}>Info:</Text> Event details and welcome (you are here!)</Text>
          </View>
          <View style={styles.howToRow}>
            <View style={styles.howToIcon}>
              <Calendar size={20} color={colors.primary} />
            </View>
            <Text style={styles.howToText}><Text style={styles.howToBold}>Agenda:</Text> View the full schedule</Text>
          </View>
          <View style={styles.howToRow}>
            <View style={styles.howToIcon}>
              <ImageIcon size={20} color={colors.primary} />
            </View>
            <Text style={styles.howToText}><Text style={styles.howToBold}>Feed:</Text> Share photos and engage to earn points</Text>
          </View>
          <View style={styles.howToRow}>
            <View style={styles.howToIcon}>
              <Trophy size={20} color={colors.primary} />
            </View>
            <Text style={styles.howToText}><Text style={styles.howToBold}>Rank:</Text> See who's winning!</Text>
          </View>
          <View style={styles.howToRow}>
            <View style={styles.howToIcon}>
              <Users size={20} color={colors.primary} />
            </View>
            <Text style={styles.howToText}><Text style={styles.howToBold}>Community:</Text> Network with fellow attendees</Text>
          </View>
          <View style={styles.howToRow}>
            <View style={styles.howToIcon}>
              <User size={20} color={colors.primary} />
            </View>
            <Text style={styles.howToText}><Text style={styles.howToBold}>Profile:</Text> Edit profile, notifications, DMs</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.changeEventBtn} onPress={handleChangeEvent}>
          <Text style={styles.changeEventText}>Change event</Text>
        </TouchableOpacity>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Event switcher modal: see all your events and switch, or join with code */}
      <Modal visible={eventSwitcherVisible} animationType="slide" transparent onRequestClose={() => setEventSwitcherVisible(false)}>
        <Pressable style={styles.eventSwitcherOverlay} onPress={() => setEventSwitcherVisible(false)}>
          <Pressable style={styles.eventSwitcherSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.eventSwitcherTitle}>Your events</Text>
            <Text style={styles.eventSwitcherHint}>Tap an event to switch, or join with a code below.</Text>
            <ScrollView style={styles.eventSwitcherList} keyboardShouldPersistTaps="handled">
              {myEvents.map((ev) => (
                <TouchableOpacity
                  key={ev.id}
                  style={[
                    styles.eventSwitcherRow,
                    currentEvent?.id === ev.id && styles.eventSwitcherRowCurrent,
                    ev.is_active === false && styles.eventSwitcherRowDisabled,
                  ]}
                  onPress={() => handleSelectEventFromList(ev)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.eventSwitcherRowName}>{ev.name}</Text>
                  <Text style={styles.eventSwitcherRowMeta}>
                    {ev.event_code ?? '—'} · {formatDate(ev.start_date)} – {formatDate(ev.end_date)}
                    {ev.is_active === false ? ' · Disabled' : ''}
                  </Text>
                  {currentEvent?.id === ev.id ? (
                    <Text style={styles.eventSwitcherCurrentBadge}>Current</Text>
                  ) : ev.is_active === false ? (
                    <Text style={styles.eventSwitcherDisabledBadge}>Disabled</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.eventSwitcherJoinRow} onPress={handleJoinWithCode} activeOpacity={0.7}>
                <Text style={styles.eventSwitcherJoinText}>Join with event code</Text>
                <Text style={styles.eventSwitcherJoinHint}>Enter a code to join a new event</Text>
              </TouchableOpacity>
            </ScrollView>
            <TouchableOpacity style={styles.eventSwitcherCancelBtn} onPress={() => setEventSwitcherVisible(false)}>
              <Text style={styles.eventSwitcherCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  // Full-bleed banner (Guidebook-style: image only, no text overlay) — fixed aspect, no overlap
  bannerWrap: {
    marginHorizontal: -theme.spacing.lg,
    marginBottom: theme.spacing.lg,
    overflow: 'hidden',
  },
  bannerImage: {
    width: '100%',
    aspectRatio: 16 / 10,
  },
  bannerImageStyle: {},
  bannerGradient: {
    width: '100%',
    aspectRatio: 16 / 10,
  },
  eventIntro: {
    marginTop: theme.spacing.sm,
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
  eventIntroVenue: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
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
  nowNextCardTouchable: { flex: 1 },
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
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.sm },
  seeAllLink: { fontSize: 14, fontWeight: '600', color: colors.primary },
  announcementsHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  hideAnnouncementsBtn: { paddingVertical: 4 },
  hideAnnouncementsText: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  announcementsCollapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: theme.sectionMarginBottom,
    backgroundColor: theme.cardBackground,
    borderRadius: theme.sectionRadius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  announcementsHasContent: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  announcementsCollapsedText: { fontSize: 15, fontWeight: '600', color: colors.text },
  announcementCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  announcementCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  dismissAnnouncementBtn: { padding: 4 },
  announcementTitle: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  noAnnouncementsHint: { fontSize: 13, color: colors.textMuted, marginTop: 8 },
  announcementContent: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  announcementDate: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
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
  pointsRow: { flexDirection: 'row', gap: theme.heroStatGap, justifyContent: 'flex-start' },
  pointsBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: theme.heroStatRadius,
    padding: theme.heroStatPadding,
    alignItems: 'flex-start',
    ...theme.cardShadow,
  },
  pointsBoxText: { fontSize: 16, fontWeight: '700', color: colors.text },
  pointsBoxLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  pointsDisclaimer: { fontSize: 11, color: 'rgba(255,255,255,0.88)', marginTop: theme.spacing.sm },
  howToRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  howToIcon: { marginRight: 10, justifyContent: 'center' },
  howToText: { flex: 1, fontSize: 14, color: colors.textSecondary },
  howToBold: { fontWeight: '600', color: colors.text },
  changeEventBtn: { alignSelf: 'center', paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  changeEventText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  eventSwitcherOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  eventSwitcherSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  eventSwitcherTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  eventSwitcherHint: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  eventSwitcherList: { maxHeight: 340 },
  eventSwitcherRow: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventSwitcherRowCurrent: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryFaded,
  },
  eventSwitcherRowDisabled: {
    opacity: 0.85,
  },
  eventSwitcherRowName: { fontSize: 16, fontWeight: '600', color: colors.text },
  eventSwitcherRowMeta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  eventSwitcherCurrentBadge: { fontSize: 12, fontWeight: '600', color: colors.primary, marginTop: 6 },
  eventSwitcherDisabledBadge: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginTop: 6 },
  eventSwitcherJoinRow: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  eventSwitcherJoinText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  eventSwitcherJoinHint: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  eventSwitcherCancelBtn: { marginTop: 16, paddingVertical: 12, alignItems: 'center' },
  eventSwitcherCancelText: { fontSize: 16, color: colors.textSecondary, fontWeight: '500' },
});
