import React, { useEffect, useState, useMemo, useRef, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  FlatList,
  Modal,
  Pressable,
  Dimensions,
  Platform,
  PanResponder,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import { Bookmark, Calendar, List, MapPin, Plus, Search, X } from 'lucide-react-native';
import { format, parseISO, isWithinInterval, isAfter } from 'date-fns';

/** Parses API date strings (PostgreSQL may return space instead of T between date and time). */
function parseDate(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== 'string') return null;
  const trimmed = iso.trim();
  const normalized = trimmed.includes(' ') ? trimmed.replace(/\s+/, 'T') : trimmed;
  try {
    const d = parseISO(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Accent for date selector and search (purple). */
const dateSelectorAccent = '#7c3aed';

/** Format a yyyy-MM-dd key for display (no date-fns, no locale; never returns "---"). */
function formatDayKey(key: string, index: number): string {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k || k.length < 10) return `Day ${index + 1}`;
  const match = k.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return `Day ${index + 1}`;
  const [, y, m, d] = match;
  const year = parseInt(y!, 10);
  const month = parseInt(m!, 10);
  const day = parseInt(d!, 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return `Day ${index + 1}`;
  if (month < 1 || month > 12 || day < 1 || day > 31) return `Day ${index + 1}`;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return `Day ${index + 1}`;
  const dow = date.getDay();
  const dayName = DAY_NAMES[dow] ?? 'Day';
  const out = `${dayName} ${month}/${day}`;
  if (!out || out.includes('---') || out.includes('Invalid')) return `Day ${index + 1}`;
  return out;
}
import { useAuthStore } from '../../stores/authStore';
import { useEventStore } from '../../stores/eventStore';
import { supabase } from '../../lib/supabase';
import { colors, sessionTypeColors } from '../../constants/colors';
import { theme } from '../../constants/theme';
import type { ScheduleSession } from '../../lib/types';

type SessionWithBookmarked = ScheduleSession & { is_bookmarked?: boolean };

function getSessionDateKey(iso: string | null | undefined): string | null {
  const d = parseDate(iso);
  return d ? format(d, 'yyyy-MM-dd') : null;
}

/** For date strip: day-of-month and weekday (e.g. 29, 'THU'). Returns null if no event start. */
function getDayDisplay(
  dayNumber: number,
  eventStartDate: string | null | undefined
): { dayOfMonth: number; weekday: string } | null {
  const key = getDateKeyForDayNumber(dayNumber, eventStartDate);
  if (!key) return null;
  const d = parseISO(key);
  if (Number.isNaN(d.getTime())) return null;
  return {
    dayOfMonth: d.getDate(),
    weekday: DAY_NAMES_ABBR[d.getDay()] ?? 'DAY',
  };
}

/** Month and year for header (e.g. 'JANUARY 2026'). */
function getMonthYearLabel(
  dayNumber: number,
  eventStartDate: string | null | undefined
): string | null {
  const key = getDateKeyForDayNumber(dayNumber, eventStartDate);
  if (!key) return null;
  const d = parseISO(key);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, 'MMMM yyyy').toUpperCase();
}

/** Date key for a given day_number (1-based) using event start_date. */
function getDateKeyForDayNumber(
  dayNumber: number,
  eventStartDate: string | null | undefined
): string | null {
  if (!eventStartDate || typeof eventStartDate !== 'string' || dayNumber == null) return null;
  const match = String(eventStartDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = parseInt(y!, 10);
  const month = parseInt(m!, 10);
  const day = parseInt(d!, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const base = new Date(year, month - 1, day);
  if (Number.isNaN(base.getTime())) return null;
  const sessionDate = new Date(base);
  sessionDate.setDate(sessionDate.getDate() + (dayNumber - 1));
  if (Number.isNaN(sessionDate.getTime())) return null;
  const y2 = sessionDate.getFullYear();
  const m2 = sessionDate.getMonth() + 1;
  const d2 = sessionDate.getDate();
  return `${y2}-${String(m2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`;
}

function isSessionHappeningNow(startTime: string, endTime: string): boolean {
  const start = parseDate(startTime);
  const end = parseDate(endTime);
  if (!start || !end) return false;
  return isWithinInterval(new Date(), { start, end });
}

function sessionTypeLabel(type: string): string {
  return type ? type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ') : '';
}

export default function ScheduleScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [sessions, setSessions] = useState<SessionWithBookmarked[]>([]);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionWithBookmarked | null>(null);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const listRef = useRef<FlatList>(null);

  const fetchSessions = async () => {
    if (!currentEvent?.id) {
      setSessions([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('schedule_sessions')
        .select('*')
        .eq('event_id', currentEvent.id)
        .eq('is_active', true)
        .order('day_number', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) throw error;
      setSessions((data ?? []) as ScheduleSession[]);
    } catch (err) {
      console.error('Schedule fetch error:', err);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchBookmarks = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('user_schedule')
        .select('session_id')
        .eq('user_id', user.id);

      if (error) throw error;
      setBookmarkedIds(new Set((data ?? []).map((r: { session_id: string }) => r.session_id)));
    } catch (err) {
      console.error('Bookmarks fetch error:', err);
    }
  };

  const fetchIsAdmin = async () => {
    if (!user?.id || !currentEvent?.id) return;
    try {
      const { data } = await supabase
        .from('event_members')
        .select('role')
        .eq('event_id', currentEvent.id)
        .eq('user_id', user.id)
        .single();
      const role = (data as { role?: string } | null)?.role;
      setIsEventAdmin(role === 'admin' || role === 'super_admin');
    } catch {
      setIsEventAdmin(false);
    }
  };

  useEffect(() => {
    fetchSessions();
    fetchIsAdmin();
  }, [currentEvent?.id]);

  useEffect(() => {
    if (user?.id && sessions.length > 0) fetchBookmarks();
  }, [user?.id, sessions.length]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchSessions(), fetchBookmarks(), fetchIsAdmin()]);
    setRefreshing(false);
  };

  const toggleBookmark = async (sessionId: string) => {
    if (!user?.id) return;
    const isBookmarked = bookmarkedIds.has(sessionId);
    try {
      if (isBookmarked) {
        await supabase.from('user_schedule').delete().eq('user_id', user.id).eq('session_id', sessionId);
        setBookmarkedIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      } else {
        await supabase.from('user_schedule').insert({ user_id: user.id, session_id: sessionId });
        setBookmarkedIds((prev) => new Set(prev).add(sessionId));
      }
    } catch (err) {
      console.error('Bookmark toggle error:', err);
    }
  };

  const sessionsWithBookmarks = useMemo(() => {
    return sessions.map((s) => ({ ...s, is_bookmarked: bookmarkedIds.has(s.id) }));
  }, [sessions, bookmarkedIds]);

  const filteredSessions = useMemo(() => {
    let list = sessionsWithBookmarks;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.title?.toLowerCase().includes(q) ||
          s.speaker_name?.toLowerCase().includes(q) ||
          s.location?.toLowerCase().includes(q) ||
          s.room?.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q)
      );
    }
    if (showSavedOnly && user?.id) list = list.filter((s) => bookmarkedIds.has(s.id));
    return list;
  }, [sessionsWithBookmarks, searchQuery, showSavedOnly, user?.id, bookmarkedIds]);

  const eventStartDate = currentEvent?.start_date ?? null;

  const dayNumbers = useMemo(() => {
    const set = new Set<number>();
    filteredSessions.forEach((s) => {
      const n = Number(s.day_number);
      if (!Number.isNaN(n) && n >= 1) set.add(n);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [filteredSessions]);

  const selectedDay = selectedDayNumber != null && dayNumbers.includes(selectedDayNumber)
    ? selectedDayNumber
    : (dayNumbers[0] ?? null);

  const sessionsForSelectedDay = useMemo(() => {
    if (selectedDay == null) return [];
    const day = Number(selectedDay);
    return filteredSessions.filter((s) => Number(s.day_number) === day);
  }, [filteredSessions, selectedDay]);

  const isSelectedDayToday = useMemo(() => {
    if (selectedDay == null || !eventStartDate) return false;
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    return getDateKeyForDayNumber(selectedDay, eventStartDate) === todayKey;
  }, [selectedDay, eventStartDate]);

  const { nowSessions, nextSessions } = useMemo(() => {
    if (!isSelectedDayToday || sessionsForSelectedDay.length === 0) {
      return { nowSessions: [], nextSessions: [] };
    }
    const now = new Date();
    const nowList: SessionWithBookmarked[] = [];
    const nextList: SessionWithBookmarked[] = [];
    for (const s of sessionsForSelectedDay) {
      const start = parseDate(s.start_time);
      const end = parseDate(s.end_time);
      if (!start || !end) continue;
      if (isWithinInterval(now, { start, end })) {
        nowList.push(s);
      } else if (isAfter(start, now)) {
        nextList.push(s);
      }
    }
    nextList.sort((a, b) => {
      const ta = parseDate(a.start_time)?.getTime() ?? 0;
      const tb = parseDate(b.start_time)?.getTime() ?? 0;
      return ta - tb;
    });
    return { nowSessions: nowList, nextSessions: nextList.slice(0, 2) };
  }, [isSelectedDayToday, sessionsForSelectedDay]);

  const dayNumbersRef = useRef<number[]>([]);
  const selectedDayRef = useRef<number | null>(null);
  dayNumbersRef.current = dayNumbers;
  selectedDayRef.current = selectedDay;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        const { dx, dy } = gestureState;
        return Math.abs(dx) > 25 && Math.abs(dx) > Math.abs(dy);
      },
      onPanResponderRelease: (_, gestureState) => {
        const { dx } = gestureState;
        const days = dayNumbersRef.current;
        const current = selectedDayRef.current;
        if (days.length === 0) return;
        const idx = current != null ? days.indexOf(current) : 0;
        if (dx < -40 && idx >= 0 && idx < days.length - 1) {
          setSelectedDayNumber(days[idx + 1]);
        } else if (dx > 40 && idx > 0) {
          setSelectedDayNumber(days[idx - 1]);
        }
      },
    })
  ).current;

  useEffect(() => {
    if (dayNumbers.length === 0) return;
    if (selectedDayNumber == null || !dayNumbers.includes(selectedDayNumber)) {
      const todayKey = format(new Date(), 'yyyy-MM-dd');
      const todayDay = eventStartDate
        ? dayNumbers.find((d) => getDateKeyForDayNumber(d, eventStartDate) === todayKey)
        : null;
      setSelectedDayNumber(todayDay ?? dayNumbers[0]);
    }
  }, [dayNumbers.length, dayNumbers.join(','), selectedDayNumber, eventStartDate]);

  const hasScrolledToNow = useRef(false);
  useEffect(() => {
    if (loading || sessionsForSelectedDay.length === 0 || selectedDay == null) return;
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    if (getDateKeyForDayNumber(selectedDay, eventStartDate) !== todayKey) return;
    if (hasScrolledToNow.current) return;
    hasScrolledToNow.current = true;
    const now = Date.now();
    const idx = sessionsForSelectedDay.findIndex((s) => {
      const end = parseDate(s.end_time);
      return end ? end.getTime() >= now : false;
    });
    if (idx >= 0 && listRef.current) {
      setTimeout(() => listRef.current?.scrollToIndex({ index: Math.max(0, idx), animated: true }), 200);
    }
  }, [loading, selectedDay, eventStartDate, sessionsForSelectedDay]);

  const goToNow = () => {
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    const todayDay = dayNumbers.find((d) => getDateKeyForDayNumber(d, eventStartDate) === todayKey);
    if (todayDay != null) {
      setSelectedDayNumber(todayDay);
      const listForToday = filteredSessions.filter((s) => Number(s.day_number) === todayDay);
      const now = Date.now();
      const idx = listForToday.findIndex((s) => {
        const end = parseDate(s.end_time);
        return end ? end.getTime() >= now : false;
      });
      setTimeout(() => {
        if (idx >= 0 && listRef.current) listRef.current.scrollToIndex({ index: Math.max(0, idx), animated: true });
      }, 150);
    } else if (dayNumbers.length > 0) setSelectedDayNumber(dayNumbers[0]);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Agenda',
      headerRight: () => (
        <View style={s.headerRight}>
          <View style={s.headerButtonGroup}>
            <TouchableOpacity style={s.headerPill} onPress={goToNow}>
              <Text style={s.headerPillText}>Now</Text>
            </TouchableOpacity>
            {sessions.length > 0 && (
              <>
                <TouchableOpacity
                  style={[s.headerIconPill, !showSavedOnly && s.headerPillActive]}
                  onPress={() => setShowSavedOnly(false)}
                  accessibilityLabel="All sessions"
                >
                  <List size={16} color={!showSavedOnly ? '#fff' : colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.headerIconPill, showSavedOnly && s.headerPillActive]}
                  onPress={() => setShowSavedOnly(true)}
                  accessibilityLabel="Saved sessions"
                >
                  <Bookmark size={16} color={showSavedOnly ? '#fff' : colors.textMuted} fill={showSavedOnly ? '#fff' : 'transparent'} />
                </TouchableOpacity>
              </>
            )}
          </View>
          {isEventAdmin && (
            <TouchableOpacity style={s.headerIconBtn} onPress={() => router.push(`/profile/admin-schedule?from=${encodeURIComponent('/(tabs)/schedule')}` as any)}>
              <Plus size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      ),
    });
  }, [navigation, isEventAdmin, goToNow, router, showSavedOnly, sessions.length]);

  const formatTime = (iso: string) => {
    const d = parseDate(iso);
    return d ? format(d, 'h:mm a') : '—';
  };
  const formatTimeRange = (start: string, end: string) => `${formatTime(start)} – ${formatTime(end)}`;

  const openSpeakerProfile = async (speakerName: string) => {
    if (!currentEvent?.id || !speakerName?.trim()) return;
    try {
      const { data: members } = await supabase
        .from('event_members')
        .select('user_id')
        .eq('event_id', currentEvent.id);
      const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
      if (userIds.length === 0) return;
      const { data: userMatch } = await supabase
        .from('users')
        .select('id')
        .in('id', userIds)
        .ilike('full_name', speakerName.trim())
        .limit(1)
        .maybeSingle();
      if (userMatch?.id) {
        setSelectedSession(null);
        router.push(`/feed/user/${userMatch.id}?from=${encodeURIComponent('/(tabs)/schedule')}` as any);
      }
    } catch (err) {
      console.error('Speaker lookup error:', err);
    }
  };

  // ─── Empty state ───
  if (!currentEvent) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <View style={s.emptyState}>
          <View style={s.emptyIconWrap}>
            <Calendar size={48} color={colors.primary} strokeWidth={1.5} />
          </View>
          <Text style={s.emptyTitle}>No event selected</Text>
          <Text style={s.emptyText}>Join an event on the Info tab to view the schedule.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Loading ───
  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <View style={s.skeletonRow}>
          <View style={[s.skeletonLine, s.skeletonTime]} />
          <View style={s.skeletonContent}>
            <View style={[s.skeletonLine, { width: '90%', height: 16, marginBottom: 8 }]} />
            <View style={[s.skeletonLine, { width: '50%', height: 12 }]} />
          </View>
        </View>
        <View style={s.skeletonDivider} />
        <View style={s.skeletonRow}>
          <View style={[s.skeletonLine, s.skeletonTime]} />
          <View style={s.skeletonContent}>
            <View style={[s.skeletonLine, { width: '80%', height: 16, marginBottom: 8 }]} />
            <View style={[s.skeletonLine, { width: '45%', height: 12 }]} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const monthYearLabel = selectedDay != null ? getMonthYearLabel(selectedDay, eventStartDate) : null;

  // ─── Main content ───
  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <View style={s.contentWrap} {...panResponder.panHandlers}>
      {/* Top panel: search + month + dates */}
      <View style={s.topPanel}>
        <View style={s.searchWrap}>
          <Search size={18} color={colors.textMuted} />
          <TextInput
            style={s.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search"
            placeholderTextColor={colors.textMuted}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
              <X size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          <View style={s.searchUnderline} />
        </View>

        {dayNumbers.length > 0 && monthYearLabel && (
          <Text style={s.monthYearHeader}>{monthYearLabel}</Text>
        )}

        {dayNumbers.length > 0 && (
          <View style={s.dateStripWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.dateStrip}
              style={s.dateStripShim}
            >
              {dayNumbers.map((dayNum, index) => {
                const isSelected = dayNum === selectedDay;
                const display = getDayDisplay(dayNum, eventStartDate);
                const todayKey = format(new Date(), 'yyyy-MM-dd');
                const isToday =
                  eventStartDate && getDateKeyForDayNumber(dayNum, eventStartDate) === todayKey;
                return (
                  <TouchableOpacity
                    key={`day-${dayNum}-${index}`}
                    style={s.dateChipOuter}
                    onPress={() => setSelectedDayNumber(dayNum)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        s.dateChipCircle,
                        isSelected && s.dateChipCircleSelected,
                        isToday && !isSelected && s.dateChipCircleToday,
                      ]}
                    >
                      <Text
                        style={[
                          s.dateChipDayNum,
                          isSelected && s.dateChipDayNumSelected,
                          isToday && !isSelected && s.dateChipDayNumToday,
                        ]}
                      >
                        {display ? display.dayOfMonth : index + 1}
                      </Text>
                    </View>
                    <Text
                      style={[
                        s.dateChipWeekday,
                        isSelected && s.dateChipWeekdaySelected,
                        isToday && !isSelected && s.dateChipWeekdayToday,
                      ]}
                    >
                      {display ? display.weekday : `DAY ${index + 1}`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      {/* Session list — guide-book style: time left, event right */}
      {sessionsForSelectedDay.length === 0 ? (
        <ScrollView
          contentContainerStyle={s.emptyList}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        >
          <View style={s.emptyIconWrap}>
            <Calendar size={44} color={colors.textMuted} strokeWidth={1.5} />
          </View>
          <Text style={s.emptyTitle}>No sessions</Text>
          <Text style={s.emptyText}>
            {filteredSessions.length === 0 && searchQuery
              ? 'No sessions match your search.'
              : sessions.length === 0
                ? 'No sessions for this event yet.'
                : 'No sessions on this day. Select another day.'}
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          ref={listRef}
          data={sessionsForSelectedDay}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.listContent}
          onScrollToIndexFailed={() => {}}
          ItemSeparatorComponent={() => <View style={s.rowDivider} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          ListHeaderComponent={
            isSelectedDayToday ? (
              <View style={s.nowNextSection}>
                <View style={s.nowNextCard}>
                  <Text style={s.nowNextLabel}>Happening now</Text>
                  {nowSessions.length > 0 ? (
                    nowSessions.map((session) => (
                      <Pressable
                        key={session.id}
                        style={s.nowNextRow}
                        onPress={() => setSelectedSession(session)}
                      >
                        <View style={s.liveDot} />
                        <View style={s.nowNextRowContent}>
                          <Text style={s.nowNextTitle} numberOfLines={1}>{session.title}</Text>
                          <Text style={s.nowNextTime}>{formatTime(session.start_time)} – {formatTime(session.end_time)}</Text>
                        </View>
                      </Pressable>
                    ))
                  ) : (
                    <Text style={s.nowNextEmpty}>Nothing right now</Text>
                  )}
                </View>
                <View style={s.nowNextCard}>
                  <Text style={s.nowNextLabel}>Up next</Text>
                  {nextSessions.length > 0 ? (
                    nextSessions.map((session) => (
                      <Pressable
                        key={session.id}
                        style={s.nowNextRow}
                        onPress={() => setSelectedSession(session)}
                      >
                        <View style={s.nowNextRowContent}>
                          <Text style={s.nowNextTitle} numberOfLines={1}>{session.title}</Text>
                          <Text style={s.nowNextTime}>{formatTime(session.start_time)}</Text>
                        </View>
                      </Pressable>
                    ))
                  ) : (
                    <Text style={s.nowNextEmpty}>No more sessions today</Text>
                  )}
                </View>
              </View>
            ) : null
          }
          ListFooterComponent={<View style={s.listFooter} />}
          renderItem={({ item: session, index }) => {
            const loc = [session.room, session.location].filter(Boolean).join(' · ');
            const isLive = isSessionHappeningNow(session.start_time, session.end_time);
            return (
              <Pressable
                style={[s.scheduleRow, index % 2 === 1 && s.scheduleRowAlt]}
                onPress={() => setSelectedSession(session)}
                android_ripple={{ color: colors.borderLight }}
              >
                <View style={s.guideTimeCol}>
                  <Text style={s.guideTime} numberOfLines={1}>{formatTime(session.start_time)}</Text>
                  <Text style={s.guideTimeEnd} numberOfLines={1}>{formatTime(session.end_time)}</Text>
                </View>
                <View style={s.guideContent}>
                  {session.session_type ? (
                    <Text style={s.guideTypeLabel}>{sessionTypeLabel(session.session_type)}</Text>
                  ) : null}
                  <Text style={s.guideTitle} numberOfLines={2}>{session.title}</Text>
                  {loc ? (
                    <View style={s.guideLocation}>
                      <MapPin size={12} color={colors.textMuted} />
                      <Text style={s.guideLocationText} numberOfLines={1}>{loc}</Text>
                    </View>
                  ) : null}
                  {isLive && (
                    <View style={s.guideLive}>
                      <View style={s.liveDot} />
                      <Text style={s.guideLiveText}>Live now</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  hitSlop={12}
                  style={s.guideBookmark}
                  onPress={(e) => {
                    e.stopPropagation();
                    toggleBookmark(session.id);
                  }}
                >
                  <Bookmark
                    size={18}
                    color={session.is_bookmarked ? colors.primary : colors.textMuted}
                    fill={session.is_bookmarked ? colors.primary : 'transparent'}
                  />
                </TouchableOpacity>
              </Pressable>
            );
          }}
        />
      )}

      </View>

      {/* Session detail modal */}
      <Modal visible={!!selectedSession} animationType="slide" transparent onRequestClose={() => setSelectedSession(null)}>
        <Pressable style={s.modalOverlay} onPress={() => setSelectedSession(null)}>
          <Pressable style={s.modalSheet} onPress={(e) => e.stopPropagation()}>
            {selectedSession && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={s.modalHeader}>
                  <Text style={s.modalTitle} numberOfLines={2}>{selectedSession.title}</Text>
                  <TouchableOpacity onPress={() => setSelectedSession(null)} hitSlop={12}>
                    <X size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>
                <View style={[s.modalBadge, { backgroundColor: (sessionTypeColors[selectedSession.session_type] ?? colors.primary) + '18' }]}>
                  <Text style={[s.modalBadgeText, { color: sessionTypeColors[selectedSession.session_type] ?? colors.primary }]}>
                    {sessionTypeLabel(selectedSession.session_type ?? 'breakout')}
                  </Text>
                </View>
                <Text style={s.modalTime}>{formatTimeRange(selectedSession.start_time, selectedSession.end_time)}</Text>
                {(selectedSession.speaker_name || selectedSession.speaker_title) && (
                  <View style={s.modalSpeaker}>
                    <TouchableOpacity
                      onPress={() => selectedSession.speaker_name && openSpeakerProfile(selectedSession.speaker_name)}
                      activeOpacity={0.7}
                      disabled={!selectedSession.speaker_name}
                    >
                      <Text style={[s.modalSpeakerName, selectedSession.speaker_name && s.modalSpeakerNameTappable]}>
                        {selectedSession.speaker_name}
                      </Text>
                    </TouchableOpacity>
                    {selectedSession.speaker_title && <Text style={s.modalSpeakerTitle}>{selectedSession.speaker_title}</Text>}
                  </View>
                )}
                {(selectedSession.room || selectedSession.location) && (
                  <View style={s.modalLocation}>
                    <MapPin size={16} color={colors.textMuted} />
                    <Text style={s.modalLocationText}>{[selectedSession.room, selectedSession.location].filter(Boolean).join(' · ')}</Text>
                  </View>
                )}
                {selectedSession.description && <Text style={s.modalDesc}>{selectedSession.description}</Text>}
                <TouchableOpacity
                  style={s.modalSaveBtn}
                  onPress={() => {
                    toggleBookmark(selectedSession.id);
                    setSelectedSession((prev) => (prev ? { ...prev, is_bookmarked: !prev.is_bookmarked } : null));
                  }}
                >
                  <Bookmark
                    size={20}
                    color={selectedSession.is_bookmarked ? colors.primary : colors.textMuted}
                    fill={selectedSession.is_bookmarked ? colors.primary : 'transparent'}
                  />
                  <Text style={s.modalSaveBtnText}>{selectedSession.is_bookmarked ? 'In My Schedule' : 'Add to My Schedule'}</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  contentWrap: { flex: 1 },
  topPanel: {
    backgroundColor: colors.background,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    paddingTop: 2,
    paddingBottom: 8,
    marginBottom: 4,
    ...Platform.select({
      ios: {
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: colors.background,
  },
  screenTitle: { fontSize: 28, fontWeight: '700', color: colors.text },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButtonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  headerPillActive: {
    backgroundColor: colors.primary,
  },
  headerPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  headerIconPill: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBtn: {
    padding: 6,
    marginLeft: 2,
  },
  searchWrap: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 0,
    paddingVertical: 2,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, padding: 0 },
  searchUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: dateSelectorAccent,
  },
  monthYearHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  dateStripWrap: { marginBottom: 8 },
  dateStripShim: { marginBottom: 0 },
  dateStrip: {
    flexDirection: 'row',
    flexGrow: 1,
    justifyContent: 'space-evenly',
    minWidth: Dimensions.get('window').width - 40,
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignItems: 'flex-end',
  },
  dateChipOuter: {
    flex: 1,
    alignItems: 'center',
    minWidth: 28,
  },
  dateChipCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateChipCircleSelected: {
    backgroundColor: dateSelectorAccent,
    borderColor: dateSelectorAccent,
  },
  dateChipCircleToday: {
    borderColor: dateSelectorAccent,
    borderWidth: 2,
  },
  dateChipDayNum: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  dateChipDayNumSelected: {
    color: '#fff',
  },
  dateChipDayNumToday: {
    color: dateSelectorAccent,
  },
  dateChipWeekday: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 4,
    letterSpacing: 0.2,
  },
  dateChipWeekdaySelected: {
    color: dateSelectorAccent,
  },
  dateChipWeekdayToday: {
    color: dateSelectorAccent,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 0,
  },
  listFooter: { height: theme.spacing.xxl },
  nowNextSection: {
    marginBottom: 16,
    paddingHorizontal: 0,
  },
  nowNextCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nowNextLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  nowNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  nowNextRowContent: {
    flex: 1,
    minWidth: 0,
  },
  nowNextTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  nowNextTime: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  nowNextEmpty: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 72,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 76,
    paddingVertical: 16,
    paddingHorizontal: 0,
  },
  scheduleRowAlt: {
    backgroundColor: colors.surface,
  },
  guideTimeCol: {
    width: 72,
    minWidth: 72,
    marginRight: 16,
    paddingTop: 2,
  },
  guideTime: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  guideTimeEnd: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  guideContent: {
    flex: 1,
    paddingRight: 8,
  },
  guideTypeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  guideTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 22,
  },
  guideLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  guideLocationText: {
    fontSize: 13,
    color: colors.textMuted,
    flex: 1,
  },
  guideLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  guideLiveText: { fontSize: 12, fontWeight: '600', color: colors.success },
  guideBookmark: {
    paddingTop: 2,
  },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyList: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, minHeight: 240 },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryFaded,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: colors.text, marginBottom: 8 },
  emptyText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  skeletonRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  skeletonContent: { flex: 1 },
  skeletonTime: { width: 64, height: 36, marginRight: 16 },
  skeletonDivider: { height: 1, backgroundColor: colors.borderLight, marginHorizontal: 20 },
  skeletonLine: { backgroundColor: colors.borderLight, borderRadius: 4 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '90%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.text, flex: 1, marginRight: 12, lineHeight: 26 },
  modalBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginBottom: 10 },
  modalBadgeText: { fontSize: 12, fontWeight: '600' },
  modalTime: { fontSize: 15, color: colors.textSecondary, fontWeight: '600', marginBottom: 12 },
  modalSpeaker: { marginBottom: 10 },
  modalSpeakerName: { fontSize: 16, fontWeight: '600', color: colors.text },
  modalSpeakerNameTappable: { color: colors.primary },
  modalSpeakerTitle: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  modalLocation: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  modalLocationText: { fontSize: 15, color: colors.textSecondary, flex: 1 },
  modalDesc: { fontSize: 15, color: colors.textSecondary, lineHeight: 22, marginBottom: 20 },
  modalSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  modalSaveBtnText: { fontSize: 16, fontWeight: '600', color: colors.text },
});
