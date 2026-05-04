import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Linking,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Store, MapPin, ChevronRight, Calendar, Users, Star } from 'lucide-react-native';
import { format, parseISO, isPast } from 'date-fns';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, supabaseStorage } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';
import { scheduleMeetingReminders, cancelAllMeetingReminders } from '../../../lib/meetingReminders';
import Avatar from '../../../components/Avatar';
import type { VendorBooth } from '../../../lib/types';

export type RepMeetingAttendee = {
  id: string;
  full_name: string | null;
  company: string | null;
  title: string | null;
  avatar_url: string | null;
  /** Includes `bookingId` so vendor scan rows can show correct local times (RPC `meeting_label` uses DB TZ). */
  meetingTimes: { start: string; end: string; bookingId: string }[];
};

export type BoothWithMeeting = VendorBooth & { meetingStart?: string; meetingEnd?: string; meetingSlotId?: string };

type VendorMeetingAttendanceRow = {
  id: string;
  subject_user_id: string;
  meeting_booking_id: string;
  attended_meeting: boolean;
  note: string;
  meeting_label?: string | null;
  updated_at: string;
};

type VendorAttendeeBadgeTokenRow = {
  user_id: string;
  token: string;
};

function formatMeetingTime(start: string, end: string): string {
  try {
    const s = parseISO(start.replace(' ', 'T'));
    const e = parseISO(end.replace(' ', 'T'));
    return `${format(s, 'EEE, MMM d · h:mm a')} – ${format(e, 'h:mm a')}`;
  } catch {
    return `${start} – ${end}`;
  }
}

/** Prefer slot times on device TZ; `meeting_label` from RPC uses Postgres `to_char` (often UTC). */
function formatVendorAttendanceMeetingLine(
  row: VendorMeetingAttendanceRow,
  attendee: RepMeetingAttendee
): string {
  const bid = row.meeting_booking_id;
  const slot = bid ? attendee.meetingTimes.find((t) => t.bookingId === bid) : undefined;
  if (slot?.start && slot?.end) {
    const raw = (row.meeting_label || '').trim();
    const vendorPart = raw.includes(' · ') ? raw.split(' · ')[0].trim() : '';
    const timePart = formatMeetingTime(slot.start, slot.end);
    if (vendorPart) return `${vendorPart} · ${timePart}`;
    return timePart;
  }
  return (row.meeting_label || '').trim() || 'General visit';
}

function toTimeMs(value: string): number {
  try {
    return parseISO(value.replace(' ', 'T')).getTime();
  } catch {
    return NaN;
  }
}

export default function ExpoScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [booths, setBooths] = useState<BoothWithMeeting[]>([]);
  const [ratedMeetingSlotIds, setRatedMeetingSlotIds] = useState<Set<string>>(new Set());
  const [repAttendees, setRepAttendees] = useState<RepMeetingAttendee[]>([]);
  const [repAttendanceByAttendee, setRepAttendanceByAttendee] = useState<Record<string, VendorMeetingAttendanceRow[]>>({});
  const [repBadgeTokensByAttendee, setRepBadgeTokensByAttendee] = useState<Record<string, string>>({});
  const [isVendorRep, setIsVendorRep] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEventAdmin, setIsEventAdmin] = useState(false);

  const fetchRepBoothIds = useCallback(async (eventId: string, uid: string, client: typeof supabase) => {
    const repsRes = await client
      .from('vendor_booth_reps')
      .select('booth_id, vendor_booths!inner(event_id)')
      .eq('user_id', uid)
      .eq('vendor_booths.event_id', eventId);
    if (!repsRes.error) {
      return (repsRes.data ?? []).map((r: { booth_id: string }) => r.booth_id);
    }
    // Backward-compat fallback for projects before migration
    const legacy = await client
      .from('vendor_booths')
      .select('id')
      .eq('event_id', eventId)
      .eq('contact_user_id', uid);
    return (legacy.data ?? []).map((b: { id: string }) => b.id);
  }, []);

  const loadVendorRepAttendance = useCallback(
    async (eventId: string, attendeeIds: string[], client: typeof supabase) => {
      const { data, error } = await client.rpc('list_vendor_meeting_attendance_for_event', {
        p_event_id: eventId,
        p_subject_ids: attendeeIds,
      });
      if (error) throw error;
      const pack = data as { rows?: VendorMeetingAttendanceRow[]; error?: string } | null;
      if (pack?.error) throw new Error(pack.error);
      const rows = Array.isArray(pack?.rows) ? pack.rows : [];
      const map: Record<string, VendorMeetingAttendanceRow[]> = {};
      for (const row of rows) {
        if (!row?.subject_user_id) continue;
        const arr = map[row.subject_user_id] ?? [];
        arr.push(row);
        map[row.subject_user_id] = arr;
      }
      setRepAttendanceByAttendee(map);
    },
    []
  );

  const loadVendorRepBadgeTokens = useCallback(
    async (eventId: string, attendeeIds: string[], client: typeof supabase) => {
      const { data, error } = await client.rpc('list_vendor_attendee_badge_tokens', {
        p_event_id: eventId,
        p_subject_ids: attendeeIds,
      });
      if (error) throw error;
      const pack = data as { rows?: VendorAttendeeBadgeTokenRow[]; error?: string } | null;
      if (pack?.error) throw new Error(pack.error);
      const rows = Array.isArray(pack?.rows) ? pack.rows : [];
      const map: Record<string, string> = {};
      for (const row of rows) {
        if (!row?.user_id || !row?.token) continue;
        map[row.user_id] = row.token;
      }
      setRepBadgeTokensByAttendee(map);
    },
    []
  );

  const fetchBooths = useCallback(async () => {
    if (!currentEvent?.id) {
      setBooths([]);
      setRepAttendanceByAttendee({});
      setRepBadgeTokensByAttendee({});
      setLoading(false);
      setError(null);
      return;
    }
    setError(null);
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      let list: BoothWithMeeting[] = [];

      if (user?.id) {
        const [roleDataRes, myBookingsRes, repBoothIds] = await Promise.all([
          client.from('event_members').select('role, roles').eq('event_id', currentEvent.id).eq('user_id', user.id).maybeSingle(),
          client
            .from('meeting_bookings')
            .select('slot_id, meeting_slots(booth_id, start_time, end_time)')
            .eq('attendee_id', user.id)
            .neq('status', 'cancelled'),
          fetchRepBoothIds(currentEvent.id, user.id, client),
        ]);
        const row = roleDataRes.data as { role?: string; roles?: string[] } | null;
        const roles = Array.isArray(row?.roles) ? row.roles : [];
        const role = row?.role ?? roles[0] ?? '';
        const isEventAdmin =
          user?.is_platform_admin === true ||
          role === 'admin' ||
          role === 'super_admin' ||
          roles.includes('admin') ||
          roles.includes('super_admin');
        const isVendorRep = repBoothIds.length > 0;

        if (isVendorRep && !isEventAdmin) {
          setIsVendorRep(true);
          const { data: slotsData } = await client
            .from('meeting_slots')
            .select('id, start_time, end_time')
            .in('booth_id', repBoothIds);
          const slotIds = (slotsData ?? []).map((s: { id: string }) => s.id);
          const slotMap = new Map((slotsData ?? []).map((s: { id: string; start_time: string; end_time: string }) => [s.id, { start: s.start_time, end: s.end_time }]));
          if (slotIds.length === 0) {
            setBooths([]);
            setRepAttendees([]);
            setRepAttendanceByAttendee({});
            setRepBadgeTokensByAttendee({});
            list = [];
          } else {
            const { data: bookingsData } = await client
              .from('meeting_bookings')
              .select('id, slot_id, attendee_id')
              .in('slot_id', slotIds)
              .neq('status', 'cancelled');
            type BookingRow = { id: string; slot_id: string; attendee_id: string };
            const bookings = (bookingsData ?? []) as BookingRow[];
            const attendeeToTimes = new Map<string, { start: string; end: string; bookingId: string }[]>();
            for (const b of bookings) {
              const slot = slotMap.get(b.slot_id);
              if (!slot) continue;
              const arr = attendeeToTimes.get(b.attendee_id) ?? [];
              arr.push({ start: slot.start, end: slot.end, bookingId: b.id });
              attendeeToTimes.set(b.attendee_id, arr);
            }
            const attendeeIds = [...attendeeToTimes.keys()];
            if (attendeeIds.length === 0) {
              setBooths([]);
              setRepAttendees([]);
              setRepAttendanceByAttendee({});
              setRepBadgeTokensByAttendee({});
              list = [];
            } else {
              const { data: usersData } = await client
                .from('users')
                .select('id, full_name, company, title, avatar_url')
                .in('id', attendeeIds);
              const userById = new Map(
                (usersData ?? []).map((u: { id: string; full_name: string | null; company: string | null; title: string | null; avatar_url: string | null }) => [
                  u.id,
                  u,
                ])
              );
              // List every person with a booking — do not drop rows if a profile SELECT misses one id.
              const attendees: RepMeetingAttendee[] = attendeeIds.map((id) => {
                const u = userById.get(id);
                const meetingTimes = attendeeToTimes.get(id) ?? [];
                if (u) {
                  return {
                    id: u.id,
                    full_name: u.full_name ?? null,
                    company: u.company ?? null,
                    title: u.title ?? null,
                    avatar_url: u.avatar_url ?? null,
                    meetingTimes,
                  };
                }
                return {
                  id,
                  full_name: null,
                  company: null,
                  title: null,
                  avatar_url: null,
                  meetingTimes,
                };
              });
              // Sort by earliest meeting time first (ascending).
              attendees.sort((a, b) => {
                const aEarliest = a.meetingTimes.length
                  ? a.meetingTimes.reduce((min, t) => (t.start < min ? t.start : min), a.meetingTimes[0].start)
                  : '';
                const bEarliest = b.meetingTimes.length
                  ? b.meetingTimes.reduce((min, t) => (t.start < min ? t.start : min), b.meetingTimes[0].start)
                  : '';
                return aEarliest.localeCompare(bEarliest);
              });
              setBooths([]);
              setRepAttendees(attendees);
              await Promise.all([
                loadVendorRepAttendance(currentEvent.id, attendeeIds, client),
                loadVendorRepBadgeTokens(currentEvent.id, attendeeIds, client),
              ]);
            }
            list = [];
          }
        } else {
          setIsVendorRep(false);
          setRepAttendees([]);
          setRepAttendanceByAttendee({});
          setRepBadgeTokensByAttendee({});
        }
        if (!isVendorRep || isEventAdmin) {
        if (!isEventAdmin) {
          type BookingRow = {
            slot_id: string;
            meeting_slots:
              | { booth_id: string; start_time: string; end_time: string }
              | { booth_id: string; start_time: string; end_time: string }[]
              | null;
          };
          const rows = (myBookingsRes.data ?? []) as unknown as BookingRow[];
          const boothIdToSlot = new Map<string, { start_time: string; end_time: string; slot_id: string }>();
          for (const r of rows) {
            const slot = Array.isArray(r.meeting_slots) ? r.meeting_slots[0] : r.meeting_slots;
            if (slot?.booth_id && slot.start_time && slot.end_time && !boothIdToSlot.has(slot.booth_id)) {
              boothIdToSlot.set(slot.booth_id, { start_time: slot.start_time, end_time: slot.end_time, slot_id: r.slot_id });
            }
          }
          const meetingBoothIds = [...boothIdToSlot.keys()];
          if (meetingBoothIds.length === 0) {
            setBooths([]);
            setLoading(false);
            setRefreshing(false);
            return;
          }
          const { data: boothData, error: e } = await client
            .from('vendor_booths')
            .select('*')
            .eq('event_id', currentEvent.id)
            .eq('is_active', true)
            .in('id', meetingBoothIds)
            .order('vendor_name');
          if (e) throw e;
          list = ((boothData ?? []) as VendorBooth[])
            .map((b) => {
              const slot = boothIdToSlot.get(b.id);
              return {
                ...b,
                meetingStart: slot?.start_time,
                meetingEnd: slot?.end_time,
                meetingSlotId: slot?.slot_id,
              };
            })
            // Attendee view: upcoming/live first (earliest first), past meetings at the bottom.
            .sort((a, b) => {
              const now = Date.now();
              const aStartMs = a.meetingStart ? Date.parse(a.meetingStart.replace(' ', 'T')) : Number.NaN;
              const bStartMs = b.meetingStart ? Date.parse(b.meetingStart.replace(' ', 'T')) : Number.NaN;
              const aEndMs = a.meetingEnd ? Date.parse(a.meetingEnd.replace(' ', 'T')) : Number.NaN;
              const bEndMs = b.meetingEnd ? Date.parse(b.meetingEnd.replace(' ', 'T')) : Number.NaN;
              const aIsPast = Number.isFinite(aEndMs) ? aEndMs < now : true;
              const bIsPast = Number.isFinite(bEndMs) ? bEndMs < now : true;

              if (aIsPast !== bIsPast) return aIsPast ? 1 : -1;

              const aSort = Number.isFinite(aStartMs) ? aStartMs : Number.MAX_SAFE_INTEGER;
              const bSort = Number.isFinite(bStartMs) ? bStartMs : Number.MAX_SAFE_INTEGER;
              return aSort - bSort;
            });

          const attendeeSlotIds = rows.map((r) => r.slot_id).filter(Boolean);
          if (attendeeSlotIds.length > 0) {
            const { data: feedbackRows } = await client
              .from('b2b_meeting_feedback')
              .select('meeting_bookings!inner(slot_id)')
              .eq('user_id', user.id)
              .in('meeting_bookings.slot_id', attendeeSlotIds);
            const ratedIds = new Set(
              (feedbackRows ?? [])
                .flatMap((row: { meeting_bookings?: { slot_id?: string | null } | Array<{ slot_id?: string | null }> | null }) => {
                  const bookings = Array.isArray(row.meeting_bookings)
                    ? row.meeting_bookings
                    : row.meeting_bookings
                      ? [row.meeting_bookings]
                      : [];
                  return bookings.map((booking) => booking.slot_id ?? '');
                }
                )
                .filter(Boolean)
            );
            setRatedMeetingSlotIds(ratedIds);
          } else {
            setRatedMeetingSlotIds(new Set());
          }
        } else {
          const { data: boothData, error: e } = await client
            .from('vendor_booths')
            .select('*')
            .eq('event_id', currentEvent.id)
            .eq('is_active', true)
            .order('vendor_name');
          if (e) throw e;
          list = (boothData ?? []) as BoothWithMeeting[];
          setRatedMeetingSlotIds(new Set());
        }
        }
      } else {
        setIsVendorRep(false);
        setRepAttendees([]);
        setRepAttendanceByAttendee({});
        setRepBadgeTokensByAttendee({});
        setRatedMeetingSlotIds(new Set());
        const { data: boothData, error: e } = await client
          .from('vendor_booths')
          .select('*')
          .eq('event_id', currentEvent.id)
          .eq('is_active', true)
          .order('vendor_name');
        if (e) throw e;
        list = (boothData ?? []) as BoothWithMeeting[];
      }

      setBooths(list);
    } catch (err) {
      console.error('Expo fetch error:', err);
      setBooths([]);
      setRepAttendees([]);
      setRepAttendanceByAttendee({});
      setRepBadgeTokensByAttendee({});
      setIsVendorRep(false);
      setError(err instanceof Error ? err.message : 'Could not load booths.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentEvent?.id, user?.id, fetchRepBoothIds, loadVendorRepAttendance, loadVendorRepBadgeTokens]);

  // Like Info: load on mount and on focus. No timeout so first try can complete.
  useEffect(() => {
    if (!currentEvent?.id) return;
    setLoading(true);
    let cancelled = false;
    fetchBooths()
      .catch(() => {
        if (!cancelled) setTimeout(() => fetchBooths().finally(() => {}), 2000);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentEvent?.id, fetchBooths]);

  useFocusEffect(
    useCallback(() => {
      if (currentEvent?.id) fetchBooths().catch(() => {});
    }, [currentEvent?.id, fetchBooths])
  );

  useEffect(() => {
    const withMeeting = booths.filter((b) => b.meetingStart && b.meetingEnd);
    if (withMeeting.length === 0) {
      cancelAllMeetingReminders();
      return;
    }
    scheduleMeetingReminders(
      withMeeting.map((b) => ({
        boothId: b.id,
        startTime: b.meetingStart!,
        endTime: b.meetingEnd!,
        vendorName: b.vendor_name ?? 'Vendor',
      }))
    );
  }, [booths]);

  const isBoothMeetingPast = (b: BoothWithMeeting) => {
    if (!b.meetingEnd) return false;
    const endMs = Date.parse(b.meetingEnd.replace(' ', 'T'));
    return Number.isFinite(endMs) ? endMs < Date.now() : false;
  };

  useEffect(() => {
    if (!user?.id || !currentEvent?.id) return;
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    (async () => {
      const { data } = await client
        .from('event_members')
        .select('role, roles')
        .eq('event_id', currentEvent.id)
        .eq('user_id', user.id)
        .maybeSingle();
      const row = data as { role?: string; roles?: string[] } | null;
      const role = row?.role ?? '';
      const roles = Array.isArray(row?.roles) ? row.roles : [];
      setIsEventAdmin(user?.is_platform_admin === true || role === 'admin' || role === 'super_admin' || roles.includes('admin') || roles.includes('super_admin'));
    })();
  }, [user?.id, currentEvent?.id]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchBooths();
  };

  const openWebsite = (url: string | null) => {
    if (!url?.trim()) return;
    const u = url.startsWith('http') ? url : `https://${url}`;
    Linking.openURL(u).catch(() => {});
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={s.container} edges={[]}>
        <View style={s.centered}>
          <Text style={s.emptyText}>Select an event to see vendor booths.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && booths.length === 0 && repAttendees.length === 0) {
    return (
      <SafeAreaView style={s.container} edges={[]}>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>{isVendorRep ? 'Loading…' : 'Loading booths…'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Vendor rep first screen: list of people who signed up to meet with them
  if (isVendorRep) {
    const nowMs = Date.now();
    const isAttendeeUpcoming = (attendee: RepMeetingAttendee) =>
      attendee.meetingTimes.some((t) => {
        const endMs = toTimeMs(t.end);
        return Number.isFinite(endMs) && endMs >= nowMs;
      });

    const upcomingAttendees = repAttendees.filter(isAttendeeUpcoming);
    const pastAttendees = repAttendees.filter((a) => !isAttendeeUpcoming(a));
    type RepListRow =
      | { kind: 'section'; id: string; label: string }
      | { kind: 'attendee'; id: string; attendee: RepMeetingAttendee };
    const repListRows: RepListRow[] = [
      ...(upcomingAttendees.length > 0 ? [{ kind: 'section', id: 'section-upcoming', label: 'Upcoming' } as const] : []),
      ...upcomingAttendees.map((attendee) => ({ kind: 'attendee', id: `attendee-${attendee.id}`, attendee }) as const),
      ...(pastAttendees.length > 0 ? [{ kind: 'section', id: 'section-past', label: 'Past' } as const] : []),
      ...pastAttendees.map((attendee) => ({ kind: 'attendee', id: `attendee-${attendee.id}`, attendee }) as const),
    ];

    return (
      <SafeAreaView style={s.container} edges={[]}>
        {error ? (
          <View style={s.errorBanner}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}
        {repAttendees.length === 0 ? (
          <View style={s.centered}>
            <Users size={48} color={colors.textMuted} />
            <Text style={s.emptyText}>No meetings assigned to you yet.</Text>
            <Text style={s.emptySubtext}>Once meetings are assigned, they will appear here.</Text>
          </View>
        ) : (
          <FlatList
            data={repListRows}
            keyExtractor={(item) => item.id}
            contentContainerStyle={s.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
            ListHeaderComponent={
              <View style={s.repHeader}>
                <Text style={s.repTitle}>People you're meeting with</Text>
                <Text style={s.repSubtitle}>{repAttendees.length} {repAttendees.length === 1 ? 'person' : 'people'} signed up</Text>
                <Text style={s.repSubtitle}>
                  {Object.keys(repAttendanceByAttendee).length} scanned
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              if (item.kind === 'section') {
                return (
                  <View style={s.repSectionHeader}>
                    <Text style={s.repSectionTitle}>{item.label}</Text>
                  </View>
                );
              }
              const attendee = item.attendee;
              const attendanceRows = repAttendanceByAttendee[attendee.id] ?? [];
              const attendeeToken = repBadgeTokensByAttendee[attendee.id];
              return (
                <TouchableOpacity
                  style={s.attendeeCard}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/(tabs)/feed/user/${attendee.id}?from=${encodeURIComponent('/(tabs)/expo')}` as any)}
                >
                  <Avatar uri={attendee.avatar_url} name={attendee.full_name} size={48} />
                  <View style={s.attendeeBody}>
                    <Text style={s.attendeeName} numberOfLines={1}>{attendee.full_name || 'Unknown'}</Text>
                    {attendee.company ? <Text style={s.attendeeMeta} numberOfLines={1}>{attendee.company}</Text> : null}
                    {attendee.title ? <Text style={s.attendeeMeta} numberOfLines={1}>{attendee.title}</Text> : null}
                    {attendee.meetingTimes.length > 0 ? (
                      <View style={s.attendeeTimes}>
                        {attendee.meetingTimes.slice(0, 2).map((t, i) => (
                          <Text key={i} style={s.attendeeTime}>{formatMeetingTime(t.start, t.end)}</Text>
                        ))}
                        {attendee.meetingTimes.length > 2 ? <Text style={s.attendeeTime}>+{attendee.meetingTimes.length - 2} more</Text> : null}
                      </View>
                    ) : null}
                    {attendeeToken ? (
                      <TouchableOpacity
                        style={s.markAttendanceLink}
                        onPress={() =>
                          router.push(
                            `/(tabs)/profile/badge-scan?t=${encodeURIComponent(attendeeToken)}&from=${encodeURIComponent('/(tabs)/expo')}` as any
                          )
                        }
                      >
                        <Text style={s.markAttendanceLinkText}>Mark attendance</Text>
                      </TouchableOpacity>
                    ) : null}
                    {attendanceRows.length > 0 ? (
                      <View style={s.scanSummaryWrap}>
                        {attendanceRows.slice(0, 2).map((row) => (
                          <View key={row.id} style={s.scanRow}>
                            <View style={[s.scanPill, row.attended_meeting ? s.scanPillAttended : s.scanPillNoShow]}>
                              <Text style={[s.scanPillText, row.attended_meeting ? s.scanPillTextAttended : s.scanPillTextNoShow]}>
                                {row.attended_meeting ? 'Attended' : 'No-show'}
                              </Text>
                            </View>
                            <Text style={s.scanMeta} numberOfLines={1}>
                              {formatVendorAttendanceMeetingLine(row, attendee)}
                            </Text>
                            {row.note?.trim() ? (
                              <Text style={s.scanNote} numberOfLines={2}>
                                {row.note.trim()}
                              </Text>
                            ) : null}
                          </View>
                        ))}
                        {attendanceRows.length > 2 ? (
                          <Text style={s.scanMeta}>+{attendanceRows.length - 2} more saved</Text>
                        ) : null}
                      </View>
                    ) : (
                      <Text style={s.scanNotRecorded}>Not scanned yet</Text>
                    )}
                  </View>
                  <ChevronRight size={22} color={colors.textMuted} strokeWidth={2} />
                </TouchableOpacity>
              );
            }}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={[]}>
      {error ? (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}
      {booths.length === 0 ? (
        <View style={s.centered}>
          <Store size={48} color={colors.textMuted} />
          <Text style={s.emptyText}>{isEventAdmin ? 'No vendor booths yet.' : 'No meetings assigned to you yet.'}</Text>
          {isEventAdmin ? (
            <>
              <Text style={s.emptySubtext}>Add vendor booths from Event admin, then assign attendees to meetings here.</Text>
              <TouchableOpacity style={s.adminCta} onPress={() => router.push('/profile/admin-vendor-booths')}>
                <Text style={s.adminCtaText}>Go to Vendor booths (Admin)</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={s.emptySubtext}>You only see vendors you have a meeting with. Ask your event organizer to assign you.</Text>
          )}
        </View>
      ) : (
        <FlatList
          data={booths}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.listContent}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={5}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
          renderItem={({ item, index }) => {
            const currentIsPast = isBoothMeetingPast(item);
            const prevIsPast = index > 0 ? isBoothMeetingPast(booths[index - 1] as BoothWithMeeting) : false;
            const showPastHeader = currentIsPast && !prevIsPast;
            return (
              <>
                {showPastHeader ? (
                  <View style={s.pastSectionHeader}>
                    <Text style={s.pastSectionTitle}>Past meetings</Text>
                  </View>
                ) : null}
                <TouchableOpacity
                  style={s.card}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/expo/${item.id}` as any)}
                >
              <View style={s.cardInner}>
                <View style={s.cardRow}>
                  {item.logo_url ? (
                    <Image
                      source={{ uri: item.logo_url }}
                      style={s.logo}
                      resizeMode="contain"
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <View style={s.logoPlaceholder}>
                      <Store size={28} color={colors.textMuted} />
                    </View>
                  )}
                  <View style={s.cardBody}>
                    <Text style={s.vendorName} numberOfLines={1}>{item.vendor_name}</Text>
                    {item.description ? (
                      <Text style={s.description} numberOfLines={2}>{item.description}</Text>
                    ) : null}
                  </View>
                  <ChevronRight size={22} color={colors.textMuted} strokeWidth={2} />
                </View>
                {item.meetingStart && item.meetingEnd ? (
                  <View style={s.meetingBlock}>
                    <View style={s.meetingRow}>
                      <Calendar size={16} color={colors.primary} />
                      <Text style={s.meetingTime}>{formatMeetingTime(item.meetingStart, item.meetingEnd)}</Text>
                    </View>
                    {item.booth_location ? (
                      <View style={s.meetingRow}>
                        <MapPin size={16} color={colors.primary} />
                        <Text style={s.meetingLocation}>{item.booth_location}</Text>
                      </View>
                    ) : null}
                    {(() => {
                      try {
                        const endDate = parseISO((item.meetingEnd ?? '').replace(' ', 'T'));
                        if (!Number.isNaN(endDate.getTime()) && isPast(endDate) && item.meetingSlotId) {
                          const alreadyRated = ratedMeetingSlotIds.has(item.meetingSlotId);
                          return (
                            alreadyRated ? (
                              <View style={s.ratedMeetingRow}>
                                <Star size={18} color={colors.primary} />
                                <Text style={s.rateMeetingBtnText}>Already rated</Text>
                              </View>
                            ) : (
                              <TouchableOpacity
                                style={s.rateMeetingBtn}
                                onPress={() => {
                                  const fromEnc = encodeURIComponent('/(tabs)/expo');
                                  router.push(`/expo/${item.id}?from=${fromEnc}&rate_slot_id=${encodeURIComponent(item.meetingSlotId!)}` as any);
                                }}
                                activeOpacity={0.7}
                              >
                                <Star size={18} color={colors.primary} />
                                <Text style={s.rateMeetingBtnText}>Rate this meeting</Text>
                              </TouchableOpacity>
                            )
                          );
                        }
                      } catch {}
                      return null;
                    })()}
                  </View>
                ) : item.booth_location ? (
                  <View style={s.metaRow}>
                    <MapPin size={14} color={colors.textMuted} />
                    <Text style={s.metaText}>{item.booth_location}</Text>
                  </View>
                ) : null}
              </View>
                </TouchableOpacity>
              </>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 12, fontSize: 15, color: colors.textSecondary },
  emptyText: { fontSize: 16, color: colors.textSecondary, textAlign: 'center' },
  emptySubtext: { marginTop: 8, fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 24 },
  adminCta: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 20, backgroundColor: colors.primary, borderRadius: 10 },
  adminCtaText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  errorBanner: { backgroundColor: colors.dangerLight, padding: 12, marginHorizontal: 16, marginTop: 8, borderRadius: 8 },
  errorText: { color: colors.danger, fontSize: 14 },
  listContent: { padding: 16, paddingBottom: 24 },
  repHeader: { marginBottom: 16, paddingHorizontal: 4 },
  repTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  repSubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  repSectionHeader: { marginTop: 4, marginBottom: 8, paddingHorizontal: 4 },
  repSectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
  pastSectionHeader: { marginTop: 4, marginBottom: 8, paddingHorizontal: 4 },
  pastSectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' },
  attendeeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 16,
    marginBottom: 12,
    padding: 16,
    ...(Platform.OS === 'android' ? { elevation: 2 } : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }),
  },
  attendeeBody: { flex: 1, marginLeft: 14, minWidth: 0 },
  attendeeName: { fontSize: 17, fontWeight: '600', color: colors.text },
  attendeeMeta: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  attendeeTimes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  attendeeTime: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  markAttendanceLink: { marginTop: 8, alignSelf: 'flex-start' },
  markAttendanceLinkText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  scanSummaryWrap: { marginTop: 8, gap: 4 },
  scanRow: { gap: 3 },
  scanPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  scanPillAttended: { backgroundColor: '#dcfce7' },
  scanPillNoShow: { backgroundColor: '#fee2e2' },
  scanPillText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  scanPillTextAttended: { color: '#166534' },
  scanPillTextNoShow: { color: '#991b1b' },
  scanMeta: { fontSize: 12, color: colors.textSecondary },
  scanNote: { fontSize: 12, color: colors.text, lineHeight: 16 },
  scanNotRecorded: { marginTop: 8, fontSize: 12, color: colors.textMuted },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    ...(Platform.OS === 'android' ? { elevation: 2 } : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }),
  },
  cardInner: { padding: 16 },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  logoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardBody: { flex: 1, marginLeft: 14, minWidth: 0 },
  vendorName: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: 0.2 },
  description: { fontSize: 14, color: colors.textSecondary, marginTop: 6, lineHeight: 20 },
  meetingBlock: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  meetingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meetingTime: { fontSize: 15, fontWeight: '600', color: colors.text },
  meetingLocation: { fontSize: 14, color: colors.textSecondary },
  rateMeetingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.primaryFaded,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  rateMeetingBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  ratedMeetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.primaryFaded,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  metaText: { fontSize: 13, color: colors.textMuted },
  websiteBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  websiteText: { fontSize: 13, color: colors.primary },
});
