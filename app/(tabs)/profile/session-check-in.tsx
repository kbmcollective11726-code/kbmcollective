import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronRight, ClipboardCheck, Search } from 'lucide-react-native';
import ProfileStackScreenHeader from '../../../components/ProfileStackScreenHeader';
import { colors } from '../../../constants/colors';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import {
  formatSessionSlotRange,
  listSessionsForCheckIn,
  type SessionCheckInListItem,
} from '../../../lib/sessionCheckInRpc';
import { effectiveCanShowSessionCheckIn } from '../../../lib/rolePreview';
import { useRolePreviewStore } from '../../../stores/rolePreviewStore';
import {
  filterSessionsForPicker,
  getDayChipDisplay,
  getSessionDayNumbers,
  isSessionLiveNow,
  pickDefaultDayNumber,
  pickFocusSessionId,
} from '../../../lib/sessionCheckInList';
import { getDateKeyForDayNumber, getDeviceLocalDateKey } from '../../../lib/scheduleNowNext';
import type { Event } from '../../../lib/types';

const ROW_HEIGHT = 96;
/** Width per date chip in horizontal strip (for scrollTo). */
const DAY_CHIP_WIDTH = 52;
const SCREEN_WIDTH = Dimensions.get('window').width;

export default function SessionCheckInPickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const isPlatformAdmin = user?.is_platform_admin === true;
  const previewRole = useRolePreviewStore((s) => s.previewRole);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [roleChecked, setRoleChecked] = useState(false);
  const [sessions, setSessions] = useState<SessionCheckInListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [eventMenuFields, setEventMenuFields] = useState<Pick<
    Event,
    'admin_console_tiles' | 'menu_show_session_check_in' | 'platform_menu_show_session_check_in'
  > | null>(null);
  const listRef = useRef<FlatList<SessionCheckInListItem>>(null);
  const dayStripRef = useRef<ScrollView>(null);

  /** Return to the tab/screen that opened the hamburger link (`?from=...`). */
  const goBack = useCallback(() => {
    const raw = params.from;
    const from = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    const fallback = '/(tabs)/home';
    if (from) {
      try {
        const decoded = decodeURIComponent(from).trim();
        if (decoded.startsWith('/')) {
          router.replace(decoded as any);
          return;
        }
      } catch {
        // fall through
      }
    }
    if (router.canGoBack()) router.back();
    else router.replace(fallback as any);
  }, [params.from, router]);

  const syncSelectedDayToToday = useCallback(
    (rows: SessionCheckInListItem[]) => {
      if (!currentEvent?.start_date) return;
      const days = getSessionDayNumbers(rows, currentEvent.start_date, currentEvent.end_date);
      if (days.length === 0) return;
      const todayKey = getDeviceLocalDateKey();
      const todayDay = days.find((d) => getDateKeyForDayNumber(d, currentEvent.start_date) === todayKey);
      if (todayDay != null) {
        setSelectedDay(todayDay);
        return;
      }
      setSelectedDay((prev) =>
        prev != null && days.includes(prev) ? prev : pickDefaultDayNumber(rows, currentEvent.start_date, currentEvent.end_date, todayKey)
      );
    },
    [currentEvent?.start_date, currentEvent?.end_date]
  );

  useEffect(() => {
    setSelectedDay(null);
    setSearchQuery('');
  }, [currentEvent?.id]);

  useEffect(() => {
    if (!user?.id || !currentEvent?.id) {
      setRoleChecked(true);
      setIsEventAdmin(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('event_members')
          .select('role, roles')
          .eq('event_id', currentEvent.id)
          .eq('user_id', user.id)
          .single();
        if (cancelled) return;
        const row = data as { role?: string; roles?: string[] } | null;
        const role = row?.role ?? 'attendee';
        const roles = Array.isArray(row?.roles) ? row.roles : [];
        const isAdmin =
          role === 'admin' ||
          role === 'super_admin' ||
          roles.includes('admin') ||
          roles.includes('super_admin');
        setIsEventAdmin(isAdmin);
        const { data: ev } = await supabase
          .from('events')
          .select(
            'admin_console_tiles, menu_show_session_check_in, platform_menu_show_session_check_in'
          )
          .eq('id', currentEvent.id)
          .maybeSingle();
        if (!cancelled && ev) {
          const evRow = ev as Pick<
            Event,
            'admin_console_tiles' | 'menu_show_session_check_in' | 'platform_menu_show_session_check_in'
          >;
          setEventMenuFields({
            admin_console_tiles: evRow.admin_console_tiles,
            menu_show_session_check_in: evRow.menu_show_session_check_in,
            platform_menu_show_session_check_in: evRow.platform_menu_show_session_check_in,
          });
        }
      } catch {
        if (!cancelled) {
          setIsEventAdmin(false);
          setEventMenuFields(null);
        }
      } finally {
        if (!cancelled) setRoleChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, currentEvent?.id]);

  const eventForMenu = currentEvent ? { ...currentEvent, ...eventMenuFields } : null;
  const canUse = effectiveCanShowSessionCheckIn(eventForMenu, isEventAdmin, isPlatformAdmin, previewRole);

  const load = useCallback(async () => {
    if (!currentEvent?.id) return;
    setLoading(true);
    setError(null);
    const res = await listSessionsForCheckIn(currentEvent.id);
    if (res.error) {
      setError(res.error);
      setSessions([]);
    } else {
      const rows = res.rows ?? [];
      setSessions(rows);
      if (rows.length > 0) syncSelectedDayToToday(rows);
    }
    setLoading(false);
  }, [currentEvent?.id, currentEvent?.start_date, currentEvent?.end_date, syncSelectedDayToToday]);

  useEffect(() => {
    if (!roleChecked || !canUse) return;
    load();
  }, [roleChecked, canUse, load]);

  useFocusEffect(
    useCallback(() => {
      if (roleChecked && canUse) load();
    }, [roleChecked, canUse, load])
  );

  useEffect(() => {
    if (!roleChecked) return;
    if (!canUse) goBack();
  }, [roleChecked, canUse, goBack]);

  const dayNumbers = useMemo(
    () => getSessionDayNumbers(sessions, currentEvent?.start_date, currentEvent?.end_date),
    [sessions, currentEvent?.start_date, currentEvent?.end_date]
  );

  const effectiveDay =
    selectedDay != null && dayNumbers.includes(selectedDay) ? selectedDay : (dayNumbers[0] ?? null);

  const agendaTimeZone = currentEvent?.reminder_timezone?.trim() || null;

  const selectedDateKey = useMemo(
    () =>
      effectiveDay != null && currentEvent?.start_date
        ? getDateKeyForDayNumber(effectiveDay, currentEvent.start_date)
        : null,
    [effectiveDay, currentEvent?.start_date]
  );

  const scrollDayStripToDay = useCallback(
    (dayNum: number, animated = true) => {
      const idx = dayNumbers.indexOf(dayNum);
      if (idx < 0) return;
      const x = Math.max(0, idx * DAY_CHIP_WIDTH - SCREEN_WIDTH / 2 + DAY_CHIP_WIDTH / 2);
      dayStripRef.current?.scrollTo({ x, animated });
    },
    [dayNumbers]
  );

  const filteredSessions = useMemo(
    () =>
      filterSessionsForPicker(
        sessions,
        effectiveDay,
        searchQuery,
        currentEvent?.start_date,
        agendaTimeZone
      ),
    [sessions, effectiveDay, searchQuery, currentEvent?.start_date, agendaTimeZone]
  );

  const focusSessionId = useMemo(
    () => pickFocusSessionId(filteredSessions, selectedDateKey, agendaTimeZone),
    [filteredSessions, selectedDateKey, agendaTimeZone]
  );

  const openScan = useCallback(
    (item: SessionCheckInListItem) => {
      router.push({
        pathname: '/profile/session-check-in-scan',
        params: {
          sessionId: item.id,
          title: item.title,
          initialCount: String(item.check_in_count),
        },
      } as any);
    },
    [router]
  );

  const listHeader = useMemo(
    () => (
      <View style={styles.listHeader}>
        {focusSessionId && !loading ? (
          <TouchableOpacity
            style={styles.jumpLink}
            onPress={() => {
              const item = filteredSessions.find((s) => s.id === focusSessionId);
              if (item) openScan(item);
            }}
          >
            <Text style={styles.jumpLinkText}>Scan current / next session →</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    ),
    [focusSessionId, loading, filteredSessions, openScan]
  );

  useEffect(() => {
    if (loading || effectiveDay == null || dayNumbers.length === 0) return;
    scrollDayStripToDay(effectiveDay, false);
    const t = setTimeout(() => scrollDayStripToDay(effectiveDay, true), 150);
    const t2 = setTimeout(() => scrollDayStripToDay(effectiveDay, true), 400);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [loading, effectiveDay, dayNumbers, scrollDayStripToDay]);

  /** Scroll session list to live now, else next upcoming (same priority as Agenda "now"). */
  useEffect(() => {
    if (loading || filteredSessions.length === 0 || !focusSessionId) return;
    const idx = filteredSessions.findIndex((s) => s.id === focusSessionId);
    if (idx < 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.2 });
    }, 320);
    return () => clearTimeout(t);
  }, [loading, filteredSessions, focusSessionId, effectiveDay]);

  if (!roleChecked) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Session check-in" onBack={goBack} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Session check-in" onBack={goBack} />
        <Text style={styles.hint}>Select an event on the Info tab first.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader variant="back" title="Session check-in" onBack={goBack} />
      {dayNumbers.length > 0 ? (
        <View style={styles.dayStripWrap}>
          <ScrollView
            ref={dayStripRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayStrip}
            keyboardShouldPersistTaps="handled"
          >
            {dayNumbers.map((d, index) => {
              const active = effectiveDay === d;
              const display = getDayChipDisplay(d, currentEvent.start_date);
              const todayKey = getDeviceLocalDateKey();
              const isToday =
                !!currentEvent.start_date &&
                getDateKeyForDayNumber(d, currentEvent.start_date) === todayKey;
              return (
                <TouchableOpacity
                  key={`day-${d}-${index}`}
                  style={styles.dateChipOuter}
                  onPress={() => setSelectedDay(d)}
                  accessibilityLabel={display?.fullLabel ?? `Day ${d}`}
                >
                  <View
                    style={[
                      styles.dateChipCircle,
                      active && styles.dateChipCircleSelected,
                      isToday && !active && styles.dateChipCircleToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dateChipDayNum,
                        active && styles.dateChipDayNumSelected,
                        isToday && !active && styles.dateChipDayNumToday,
                      ]}
                    >
                      {display?.dayOfMonth ?? index + 1}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.dateChipWeekday,
                      active && styles.dateChipWeekdaySelected,
                      isToday && !active && styles.dateChipWeekdayToday,
                    ]}
                  >
                    {display?.weekday ?? `DAY ${d}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search sessions"
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <ActivityIndicator style={styles.listLoader} color={colors.primary} />
      ) : (
        <FlatList
          ref={listRef}
          style={styles.listFlex}
          data={filteredSessions}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          contentContainerStyle={styles.list}
          ListHeaderComponent={listHeader}
          keyboardShouldPersistTaps="handled"
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
            }, 100);
          }}
          ListEmptyComponent={
            <Text style={styles.muted}>
              {searchQuery.trim()
                ? 'No sessions match your search.'
                : 'No active sessions for this day. Try another day or add sessions in Manage schedule.'}
            </Text>
          }
          renderItem={({ item }) => {
            const isFocus = item.id === focusSessionId;
            const isLive = isSessionLiveNow(item, selectedDateKey, agendaTimeZone);
            return (
              <TouchableOpacity
                style={[styles.row, isFocus && styles.rowFocus, isLive && styles.rowLive]}
                onPress={() => openScan(item)}
              >
                <ClipboardCheck size={22} color={isLive ? colors.success : colors.primary} />
                <View style={styles.rowText}>
                  <View style={styles.titleRow}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {isLive ? (
                      <View style={styles.liveBadge}>
                        <Text style={styles.liveBadgeText}>NOW</Text>
                      </View>
                    ) : isFocus ? (
                      <View style={styles.nextBadge}>
                        <Text style={styles.nextBadgeText}>NEXT</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.rowMeta}>{formatSessionSlotRange(item.start_time, item.end_time)}</Text>
                  {item.room || item.location ? (
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {[item.room, item.location].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  <Text style={styles.count}>{item.check_in_count} checked in</Text>
                </View>
                <ChevronRight size={20} color={colors.textMuted} />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  dayStripWrap: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  dayStrip: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'flex-end',
    gap: 4,
  },
  dateChipOuter: {
    width: DAY_CHIP_WIDTH,
    alignItems: 'center',
  },
  dateChipCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateChipCircleSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dateChipCircleToday: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  dateChipDayNum: { fontSize: 14, fontWeight: '700', color: colors.text },
  dateChipDayNumSelected: { color: colors.textOnPrimary },
  dateChipDayNumToday: { color: colors.primary },
  dateChipWeekday: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  dateChipWeekdaySelected: { color: colors.primary },
  dateChipWeekdayToday: { color: colors.primary },
  toolbar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  hint: { fontSize: 13, color: colors.textSecondary, paddingHorizontal: 20, marginBottom: 8 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 2 },
  listFlex: { flex: 1 },
  listLoader: { marginTop: 32 },
  listHeader: { paddingTop: 4, paddingBottom: 2 },
  jumpLink: { paddingVertical: 4, paddingHorizontal: 16 },
  jumpLinkText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  error: { color: colors.danger, paddingHorizontal: 16, marginBottom: 4 },
  muted: { color: colors.textMuted, padding: 20, textAlign: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    minHeight: ROW_HEIGHT - 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  rowFocus: { borderColor: colors.primary, borderWidth: 2 },
  rowLive: { borderColor: colors.success, backgroundColor: '#f0fdf4' },
  rowText: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  liveBadge: {
    backgroundColor: colors.success,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  liveBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  nextBadge: {
    backgroundColor: colors.primaryFaded,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  nextBadgeText: { fontSize: 10, fontWeight: '800', color: colors.primary },
  rowMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  count: { fontSize: 12, fontWeight: '600', color: colors.primary, marginTop: 6 },
});
