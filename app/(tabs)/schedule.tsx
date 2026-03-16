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
  ActivityIndicator,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Bookmark, Calendar, List, MapPin, Plus, Search, Star, Store, X } from 'lucide-react-native';
import { format, parseISO, isWithinInterval, isPast } from 'date-fns';

/** Parses API date strings (PostgreSQL may return space instead of T between date and time). */
function parseDate(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== 'string') return null;
  const trimmed = iso.trim();
  // Only replace the first space between date (YYYY-MM-DD) and time so timezone offset is preserved
  const normalized = /^\d{4}-\d{2}-\d{2}\s/.test(trimmed)
    ? trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    : trimmed;
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
import { supabase, withRetryAndRefresh, refreshSessionIfNeeded } from '../../lib/supabase';
import { withRefreshTimeout } from '../../lib/refreshWithTimeout';
import { colors, sessionTypeColors } from '../../constants/colors';
import { theme } from '../../constants/theme';
import type { ScheduleSession, SessionRating } from '../../lib/types';

type SessionWithBookmarked = ScheduleSession & { is_bookmarked?: boolean };

export type B2BMeetingItem = {
  type: 'b2b';
  id: string;
  booth_id: string;
  vendor_name: string;
  start_time: string;
  end_time: string;
  dateKey: string;
};

type AgendaListItem = SessionWithBookmarked | B2BMeetingItem;

function isB2BItem(item: AgendaListItem): item is B2BMeetingItem {
  return (item as B2BMeetingItem).type === 'b2b';
}

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

/** All day numbers (1 to N) for the event's date range (start_date through end_date inclusive). */
function getEventDayNumbers(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): number[] {
  if (!startDate || !endDate || typeof startDate !== 'string' || typeof endDate !== 'string') return [];
  const startStr = startDate.trim().split(/\s/)[0] ?? '';
  const endStr = endDate.trim().split(/\s/)[0] ?? '';
  const start = parseISO(startStr);
  const end = parseISO(endStr);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  if (endMs < startMs) return [];
  const days = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  return Array.from({ length: Math.max(1, Math.min(days, 365)) }, (_, i) => i + 1);
}

function isSessionHappeningNow(startTime: string, endTime: string): boolean {
  const now = new Date();
  const start = parseDate(startTime);
  const end = parseDate(endTime);
  if (!start || !end) return false;
  // Primary: instant-in-time comparison (works when DB uses UTC correctly)
  if (isWithinInterval(now, { start, end })) return true;
  // Fallback: same calendar day (local) and current time within session's local time range
  // so "1:00 PM - 2:30 PM" on screen matches "happening now" at 1:33 PM
  const todayKey = format(now, 'yyyy-MM-dd');
  if (format(start, 'yyyy-MM-dd') !== todayKey || format(end, 'yyyy-MM-dd') !== todayKey) return false;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = start.getHours() * 60 + start.getMinutes();
  const endMins = end.getHours() * 60 + end.getMinutes();
  return nowMins >= startMins && nowMins <= endMins;
}

function sessionTypeLabel(type: string): string {
  return type ? type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ') : '';
}

/** Format one or more session types (comma-separated) for display. */
function sessionTypesDisplay(sessionType: string | null | undefined): string {
  if (!sessionType) return '';
  return sessionType.split(',').map((t) => sessionTypeLabel(t.trim())).filter(Boolean).join(', ');
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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionWithBookmarked | null>(null);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [b2bMeetings, setB2bMeetings] = useState<B2BMeetingItem[]>([]);
  const listRef = useRef<FlatList>(null);
  // Session rating (modal): current user's rating/comment and aggregate stats for admins
  const [myRating, setMyRating] = useState<SessionRating | null>(null);
  const [ratingDraft, setRatingDraft] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [ratingStats, setRatingStats] = useState<{ avg_rating: number | null; count: number } | null>(null);
  const [loadingRating, setLoadingRating] = useState(false);
  const [savingRating, setSavingRating] = useState(false);
  const [ratingJustSaved, setRatingJustSaved] = useState(false);

  const fetchInProgressRef = useRef(false);
  const fetchSessions = async () => {
    if (!currentEvent?.id) {
      setSessions([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    if (fetchInProgressRef.current) return;
    fetchInProgressRef.current = true;
    setFetchError(null);
    try {
      await withRetryAndRefresh(async () => {
        const { data, error } = await supabase
          .from('schedule_sessions')
          .select('id, event_id, title, description, speaker_name, speaker_title, speaker_photo, speakers, location, room, start_time, end_time, day_number, track, session_type, is_active, sort_order')
          .eq('event_id', currentEvent.id)
          .eq('is_active', true)
          .order('day_number', { ascending: true })
          .order('start_time', { ascending: true });

        if (error) throw error;
        setSessions((data ?? []) as ScheduleSession[]);
      });
      setFetchError(null);
    } catch (err) {
      if (__DEV__) console.warn('Schedule fetch error:', err);
      setSessions([]);
      setFetchError('Error - page not loading');
    } finally {
      fetchInProgressRef.current = false;
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
        .select('role, roles')
        .eq('event_id', currentEvent.id)
        .eq('user_id', user.id)
        .single();
      const row = data as { role?: string; roles?: string[] } | null;
      const role = row?.role;
      const roles = Array.isArray(row?.roles) ? row.roles : [];
      setIsEventAdmin(role === 'admin' || role === 'super_admin' || roles.includes('admin') || roles.includes('super_admin'));
    } catch {
      setIsEventAdmin(false);
    }
  };

  const fetchB2BMeetings = async () => {
    if (!user?.id || !currentEvent?.id) {
      setB2bMeetings([]);
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
      const slotList: { slot_id: string; booth_id: string; start_time: string; end_time: string }[] = [];
      for (const r of rows) {
        const slot = r.meeting_slots;
        if (slot?.booth_id && slot.start_time && slot.end_time)
          slotList.push({ slot_id: r.slot_id, booth_id: slot.booth_id, start_time: slot.start_time, end_time: slot.end_time });
      }
      if (slotList.length === 0) {
        setB2bMeetings([]);
        return;
      }
      const boothIds = [...new Set(slotList.map((s) => s.booth_id))];
      const { data: boothData } = await supabase
        .from('vendor_booths')
        .select('id, vendor_name')
        .eq('event_id', currentEvent.id)
        .in('id', boothIds);
      const nameByBooth = new Map((boothData ?? []).map((b: { id: string; vendor_name: string }) => [b.id, b.vendor_name ?? 'B2B']));
      const list: B2BMeetingItem[] = slotList.map((s) => {
        let dateKey = '';
        try {
          const d = parseDate(s.start_time);
          dateKey = d ? format(d, 'yyyy-MM-dd') : '';
        } catch {
          dateKey = '';
        }
        return {
          type: 'b2b',
          id: s.slot_id,
          booth_id: s.booth_id,
          vendor_name: nameByBooth.get(s.booth_id) ?? 'B2B meeting',
          start_time: s.start_time,
          end_time: s.end_time,
          dateKey,
        };
      });
      list.sort((a, b) => (parseDate(a.start_time)?.getTime() ?? 0) - (parseDate(b.start_time)?.getTime() ?? 0));
      setB2bMeetings(list);
    } catch (err) {
      if (__DEV__) console.warn('B2B meetings fetch error:', err);
      setB2bMeetings([]);
    }
  };

  const LOAD_TIMEOUT_MS = 45000; // pull-to-refresh only

  // Like Info: run and wait. No timer so first try can complete.
  useEffect(() => {
    if (!currentEvent?.id || !user?.id) {
      setSessions([]);
      setLoading(false);
      setFetchError(null);
      setB2bMeetings([]);
      return;
    }
    let cancelled = false;
    Promise.all([fetchSessions(), fetchIsAdmin(), fetchB2BMeetings()])
      .catch(() => { if (!cancelled) setTimeout(() => Promise.all([fetchSessions(), fetchIsAdmin(), fetchB2BMeetings()]).finally(() => {}), 2000); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentEvent?.id, user?.id]);

  useEffect(() => {
    if (user?.id && sessions.length > 0) fetchBookmarks();
  }, [user?.id, sessions.length]);

  // When session modal opens, fetch current user's rating and (for admins) aggregate stats
  useEffect(() => {
    if (!selectedSession || !user?.id) {
      setMyRating(null);
      setRatingDraft(null);
      setCommentDraft('');
      setRatingStats(null);
      setRatingJustSaved(false);
      return;
    }
    let cancelled = false;
    setLoadingRating(true);
    setRatingDraft(null);
    setCommentDraft('');
    setRatingStats(null);
    (async () => {
      try {
        const { data: row } = await supabase
          .from('session_ratings')
          .select('id, session_id, event_id, user_id, rating, comment, created_at')
          .eq('session_id', selectedSession.id)
          .eq('user_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        const rating = (row ?? null) as SessionRating | null;
        setMyRating(rating ?? null);
        setRatingDraft(rating?.rating ?? null);
        setCommentDraft(rating?.comment ?? '');
        if (isEventAdmin) {
          const { data: stats } = await supabase.rpc('get_session_rating_stats', { p_session_id: selectedSession.id });
          if (!cancelled && stats) setRatingStats(stats as { avg_rating: number | null; count: number });
        }
      } catch (e) {
        if (!cancelled) console.error('Fetch session rating error:', e);
      } finally {
        if (!cancelled) setLoadingRating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSession?.id, user?.id, isEventAdmin]);

  const saveSessionRating = async () => {
    if (!selectedSession || !user?.id || ratingDraft == null || ratingDraft < 1 || ratingDraft > 5) return;
    setSavingRating(true);
    setRatingJustSaved(false);
    const doSave = async () => {
      await supabase.from('session_ratings').upsert(
        {
          session_id: selectedSession.id,
          event_id: selectedSession.event_id,
          user_id: user.id,
          rating: ratingDraft,
          comment: commentDraft.trim() || null,
        },
        { onConflict: 'session_id,user_id' }
      );
      const { data: updated } = await supabase
        .from('session_ratings')
        .select('id, session_id, event_id, user_id, rating, comment, created_at')
        .eq('session_id', selectedSession.id)
        .eq('user_id', user.id)
        .single();
      if (updated) setMyRating(updated as SessionRating);
      if (isEventAdmin) {
        const { data: stats } = await supabase.rpc('get_session_rating_stats', { p_session_id: selectedSession.id });
        if (stats) setRatingStats(stats as { avg_rating: number | null; count: number });
      }
      setRatingJustSaved(true);
      setTimeout(() => setRatingJustSaved(false), 3000);
    };
    try {
      await doSave();
    } catch (e) {
      console.error('Save session rating error:', e);
      try {
        await doSave();
      } catch (e2) {
        console.error('Session rating retry error:', e2);
      }
    } finally {
      setSavingRating(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    setFetchError(null);
    try {
      await withRefreshTimeout(Promise.all([fetchSessions(), fetchBookmarks(), fetchIsAdmin(), fetchB2BMeetings()]), LOAD_TIMEOUT_MS);
    } catch {
      setFetchError('Error - page not loading');
    } finally {
      setRefreshing(false);
    }
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
          (Array.isArray(s.speakers) && (s.speakers as { name?: string }[]).some((sp) => sp?.name?.toLowerCase().includes(q))) ||
          s.location?.toLowerCase().includes(q) ||
          s.room?.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q)
      );
    }
    if (showSavedOnly && user?.id) list = list.filter((s) => bookmarkedIds.has(s.id));
    return list;
  }, [sessionsWithBookmarks, searchQuery, showSavedOnly, user?.id, bookmarkedIds]);

  const eventStartDate = currentEvent?.start_date ?? null;
  const eventEndDate = currentEvent?.end_date ?? null;

  const dayNumbers = useMemo(() => {
    const fromRange = getEventDayNumbers(eventStartDate, eventEndDate);
    if (fromRange.length > 0) return fromRange;
    const set = new Set<number>();
    filteredSessions.forEach((s) => {
      const n = Number(s.day_number);
      if (!Number.isNaN(n) && n >= 1) set.add(n);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [eventStartDate, eventEndDate, filteredSessions]);

  const selectedDay = selectedDayNumber != null && dayNumbers.includes(selectedDayNumber)
    ? selectedDayNumber
    : (dayNumbers[0] ?? null);

  const sessionsForSelectedDay = useMemo((): AgendaListItem[] => {
    if (selectedDay == null || !eventStartDate) return [];
    const selectedDateKey = getDateKeyForDayNumber(selectedDay, eventStartDate);
    if (!selectedDateKey) return [];
    const sessionList = filteredSessions.filter((s) => getSessionDateKey(s.start_time) === selectedDateKey);
    const b2bForDay = b2bMeetings.filter((b) => b.dateKey === selectedDateKey);
    const list: AgendaListItem[] = [...sessionList, ...b2bForDay];
    list.sort((a, b) => {
      const ta = isB2BItem(a) ? parseDate(a.start_time)?.getTime() ?? 0 : parseDate(a.start_time)?.getTime() ?? 0;
      const tb = isB2BItem(b) ? parseDate(b.start_time)?.getTime() ?? 0 : parseDate(b.start_time)?.getTime() ?? 0;
      return ta - tb;
    });
    return list;
  }, [filteredSessions, selectedDay, eventStartDate, b2bMeetings]);

  /** Session IDs currently happening (for live indicator on rows). B2B items are excluded. */
  const liveSessionIds = useMemo(() => {
    const now = new Date().getTime();
    const set = new Set<string>();
    for (const s of sessionsForSelectedDay) {
      if (isB2BItem(s)) continue;
      const start = parseDate(s.start_time);
      const end = parseDate(s.end_time);
      if (start && end && now >= start.getTime() && now <= end.getTime()) set.add(s.id);
    }
    return set;
  }, [sessionsForSelectedDay]);

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

  // When user opens Agenda tab: refetch (so admin edits/deletes show) and show today / scroll to now
  useFocusEffect(
    React.useCallback(() => {
      if (currentEvent?.id) {
        fetchSessions().catch(() => {});
        fetchB2BMeetings().catch(() => {});
      }
      if (dayNumbers.length === 0 || !eventStartDate) return;
      const todayKey = format(new Date(), 'yyyy-MM-dd');
      const todayDay = dayNumbers.find((d) => getDateKeyForDayNumber(d, eventStartDate) === todayKey);
      if (todayDay != null) {
        setSelectedDayNumber(todayDay);
        hasScrolledToNow.current = false;
      }
    }, [currentEvent?.id, dayNumbers.length, eventStartDate])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && currentEvent?.id) {
        fetchInProgressRef.current = false;
        refreshSessionIfNeeded()
          .catch(() => {})
          .finally(() => {
            fetchSessions().catch(() => {});
            fetchB2BMeetings().catch(() => {});
          });
      }
    });
    return () => sub.remove();
  }, [currentEvent?.id]);

  const loadingStartRef = React.useRef<number | null>(null);
  useEffect(() => {
    if (!loading) {
      loadingStartRef.current = null;
      return;
    }
    loadingStartRef.current = Date.now();
    const t = setTimeout(() => {
      if (loadingStartRef.current !== null && Date.now() - loadingStartRef.current >= 40000) {
        setLoading(false);
        setFetchError('Error - page not loading');
      }
    }, 40000);
    return () => clearTimeout(t);
  }, [loading]);

  const goToNow = () => {
    const todayKey = format(new Date(), 'yyyy-MM-dd');
    const todayDay = dayNumbers.find((d) => getDateKeyForDayNumber(d, eventStartDate) === todayKey);
    if (todayDay != null) {
      setSelectedDayNumber(todayDay);
      const listForToday = filteredSessions.filter((s) => getSessionDateKey(s.start_time) === todayKey);
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
      headerTitleAlign: 'left',
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

  // ─── Loading or fetch error: show Agenda layout immediately so the tab "loads"; content is loading/error + retry.
  if (loading || fetchError) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
        >
          <View style={s.emptyState}>
            <View style={s.emptyIconWrap}>
              <Calendar size={48} color={colors.primary} strokeWidth={1.5} />
            </View>
            {loading ? (
              <>
                <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: 12 }} />
                <Text style={s.emptyTitle}>Loading schedule…</Text>
                <Text style={s.emptyText}>Pull down to refresh</Text>
              </>
            ) : (
              <>
                <Text style={s.emptyTitle}>Error - page not loading</Text>
                <Text style={s.emptyText}>Pull down to refresh or tap Try again.</Text>
                <Pressable
                  onPress={() => {
                    setFetchError(null);
                    setLoading(true);
                    fetchSessions();
                  }}
                  style={({ pressed }) => [s.retryBtn, pressed && { opacity: 0.85 }]}
                >
                  <Text style={s.retryBtnText}>Try again</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
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
          keyExtractor={(item) => isB2BItem(item) ? `b2b-${item.id}` : item.id}
          contentContainerStyle={s.listContent}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={5}
          onScrollToIndexFailed={() => {}}
          ItemSeparatorComponent={() => <View style={s.rowDivider} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          ListHeaderComponent={null}
          ListFooterComponent={<View style={s.listFooter} />}
          renderItem={({ item, index }) => {
            if (isB2BItem(item)) {
              const b2bEnd = parseDate(item.end_time);
              const canRate = b2bEnd != null && isPast(b2bEnd);
              return (
                <TouchableOpacity
                  style={[s.scheduleRow, s.b2bRow, index % 2 === 1 && s.scheduleRowAlt]}
                  onPress={() => router.push(`/(tabs)/expo/${item.booth_id}?from=${encodeURIComponent('/(tabs)/schedule')}` as any)}
                  activeOpacity={0.7}
                >
                  <View style={s.b2bTimeCol}>
                    <Text style={s.b2bTime} numberOfLines={1}>{formatTime(item.start_time)}</Text>
                  </View>
                  <View style={s.b2bContent}>
                    <View style={s.b2bContentInner}>
                      <View style={s.b2bTitleRow}>
                        <Store size={14} color={colors.primary} style={{ marginRight: 6 }} />
                        <Text style={s.b2bVendor} numberOfLines={1}>{item.vendor_name}</Text>
                        <Text style={s.b2bLabel}>B2B</Text>
                      </View>
                      {canRate ? (
                        <Text style={s.b2bTapToRate}>Tap to rate this meeting</Text>
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }
            const session = item;
            const loc = [session.room, session.location].filter(Boolean).join(' · ');
            const isLive = liveSessionIds.has(session.id);
            const rowStyle = [s.scheduleRow, index % 2 === 1 && !isLive && s.scheduleRowAlt];
            return (
              <Pressable
                style={rowStyle}
                onPress={() => setSelectedSession(session)}
                android_ripple={{ color: colors.borderLight }}
              >
                {isLive ? (
                  <View style={s.scheduleRowLiveWrap}>
                    <View style={s.guideTimeCol}>
                      <Text style={s.guideTime} numberOfLines={1}>{formatTime(session.start_time)}</Text>
                      <Text style={s.guideTimeEnd} numberOfLines={1}>{formatTime(session.end_time)}</Text>
                    </View>
                    <View style={s.guideContent}>
                      {session.session_type ? (
                        <Text style={s.guideTypeLabel}>{sessionTypesDisplay(session.session_type)}</Text>
                      ) : null}
                      <Text style={s.guideTitle} numberOfLines={2}>{session.title}</Text>
                      {loc ? (
                        <View style={s.guideLocation}>
                          <MapPin size={12} color={colors.textMuted} />
                          <Text style={s.guideLocationText} numberOfLines={1}>{loc}</Text>
                        </View>
                      ) : null}
                      <View style={s.guideLive}>
                        <View style={s.liveDot} />
                        <Text style={s.guideLiveText}>Live now</Text>
                      </View>
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
                  </View>
                ) : (
                  <>
                    <View style={s.guideTimeCol}>
                      <Text style={s.guideTime} numberOfLines={1}>{formatTime(session.start_time)}</Text>
                      <Text style={s.guideTimeEnd} numberOfLines={1}>{formatTime(session.end_time)}</Text>
                    </View>
                    <View style={s.guideContent}>
                      {session.session_type ? (
                        <Text style={s.guideTypeLabel}>{sessionTypesDisplay(session.session_type)}</Text>
                      ) : null}
                      <Text style={s.guideTitle} numberOfLines={2}>{session.title}</Text>
                      {loc ? (
                        <View style={s.guideLocation}>
                          <MapPin size={12} color={colors.textMuted} />
                          <Text style={s.guideLocationText} numberOfLines={1}>{loc}</Text>
                        </View>
                      ) : null}
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
                  </>
                )}
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
                <View style={[s.modalBadge, { backgroundColor: (sessionTypeColors[selectedSession.session_type?.split(',')[0]?.trim() ?? ''] ?? colors.primary) + '18' }]}>
                  <Text style={[s.modalBadgeText, { color: sessionTypeColors[selectedSession.session_type?.split(',')[0]?.trim() ?? ''] ?? colors.primary }]}>
                    {sessionTypesDisplay(selectedSession.session_type ?? 'breakout')}
                  </Text>
                </View>
                <Text style={s.modalTime}>{formatTimeRange(selectedSession.start_time, selectedSession.end_time)}</Text>
                {((Array.isArray(selectedSession.speakers) && selectedSession.speakers.length > 0) || selectedSession.speaker_name || selectedSession.speaker_title) && (
                  <View style={s.modalSpeaker}>
                    {Array.isArray(selectedSession.speakers) && selectedSession.speakers.length > 0
                      ? selectedSession.speakers.map((sp, idx) => (
                          <View key={idx} style={idx > 0 ? { marginTop: 8 } : undefined}>
                            <TouchableOpacity
                              onPress={() => sp?.name && openSpeakerProfile(sp.name)}
                              activeOpacity={0.7}
                              disabled={!sp?.name}
                            >
                              <Text style={[s.modalSpeakerName, sp?.name && s.modalSpeakerNameTappable]}>{sp?.name}</Text>
                            </TouchableOpacity>
                            {(sp?.title || sp?.company) ? (
                              <Text style={s.modalSpeakerTitle}>{[sp.title, sp.company].filter(Boolean).join(' · ')}</Text>
                            ) : null}
                          </View>
                        ))
                      : (
                        <>
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
                        </>
                      )}
                  </View>
                )}
                {(selectedSession.room || selectedSession.location) && (
                  <View style={s.modalLocation}>
                    <MapPin size={16} color={colors.textMuted} />
                    <Text style={s.modalLocationText}>{[selectedSession.room, selectedSession.location].filter(Boolean).join(' · ')}</Text>
                  </View>
                )}
                {selectedSession.description && <Text style={s.modalDesc}>{selectedSession.description}</Text>}
                {/* Rate this session */}
                {user?.id && (
                  <View style={s.modalRatingBlock}>
                    <Text style={s.modalRatingTitle}>Rate this session</Text>
                    {loadingRating ? (
                      <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 8 }} />
                    ) : (
                      <>
                        <View style={s.modalStarsRow}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <TouchableOpacity
                              key={star}
                              onPress={() => setRatingDraft(star)}
                              hitSlop={8}
                              style={s.modalStarBtn}
                            >
                              <Star
                                size={28}
                                color={(ratingDraft ?? 0) >= star ? colors.primary : colors.textMuted}
                                fill={(ratingDraft ?? 0) >= star ? colors.primary : 'transparent'}
                              />
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TextInput
                          style={s.modalCommentInput}
                          placeholder="Optional comment"
                          placeholderTextColor={colors.textMuted}
                          value={commentDraft}
                          onChangeText={setCommentDraft}
                          multiline
                          maxLength={500}
                        />
                        <TouchableOpacity
                          style={[s.modalRatingSaveBtn, savingRating && s.modalRatingSaveBtnDisabled]}
                          onPress={saveSessionRating}
                          disabled={savingRating || ratingDraft == null}
                        >
                          {savingRating ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text style={s.modalRatingSaveBtnText}>{ratingJustSaved ? 'Saved' : 'Save rating'}</Text>
                          )}
                        </TouchableOpacity>
                        {ratingJustSaved && (
                          <Text style={[s.modalRatingStats, { color: colors.primary, marginTop: 6 }]}>Rating saved</Text>
                        )}
                        {isEventAdmin && ratingStats != null && ratingStats.count > 0 && (
                          <Text style={s.modalRatingStats}>
                            Average: {ratingStats.avg_rating != null ? Number(ratingStats.avg_rating).toFixed(1) : '—'} ({ratingStats.count} rating{ratingStats.count !== 1 ? 's' : ''})
                          </Text>
                        )}
                      </>
                    )}
                  </View>
                )}
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
    paddingVertical: 6,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 17, color: colors.text, padding: 0, minHeight: 28 },
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
  b2bRow: {
    minHeight: 40,
    paddingVertical: 10,
  },
  b2bTimeCol: {
    width: 52,
    marginRight: 8,
  },
  b2bTime: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  b2bContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  b2bContentInner: {
    flex: 1,
    minWidth: 0,
  },
  b2bTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  b2bTapToRate: {
    fontSize: 11,
    color: colors.primary,
    marginTop: 2,
    marginLeft: 20,
  },
  b2bVendor: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  b2bLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primary,
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  scheduleRowLiveWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    minHeight: 76,
    paddingVertical: 16,
    paddingHorizontal: 0,
    marginLeft: -20,
    paddingLeft: 20,
    borderLeftWidth: 8,
    borderLeftColor: colors.primary,
    backgroundColor: 'rgba(37, 99, 235, 0.07)',
    marginRight: 4,
    borderRadius: 0,
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
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  guideLiveText: { fontSize: 12, fontWeight: '600', color: colors.primary },
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
  retryBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  retryBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
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
  modalRatingBlock: { marginBottom: 24 },
  modalRatingTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8 },
  modalStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  modalStarBtn: { padding: 4 },
  modalCommentInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  modalRatingSaveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  modalRatingSaveBtnDisabled: { opacity: 0.6 },
  modalRatingSaveBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  modalRatingStats: { fontSize: 13, color: colors.textMuted, marginTop: 8 },
});
