import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Linking,
  Image,
  Alert,
  Modal,
  Pressable,
  TextInput,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Store, MapPin, ExternalLink, ChevronLeft, Calendar, UserPlus, ChevronDown, Clock, Star, CheckCircle, History } from 'lucide-react-native';
import { format } from 'date-fns';
import {
  isSessionLiveWallClockOnEventDay,
  isSessionNotYetEndedWallClockOnEventDay,
  isB2BSlotPastWallClock,
  getSessionDateKeyFromIso,
  parseSessionDate,
} from '../../../lib/scheduleNowNext';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, supabaseStorage } from '../../../lib/supabase';
import { ensureCurrentEventForId } from '../../../lib/ensureEventForNotification';
import { fetchBoothRepresentatives, type BoothRepresentative } from '../../../lib/vendorBoothReps';
import MeetingRepresentatives from '../../../components/MeetingRepresentatives';
import { awardPoints } from '../../../lib/points';
import {
  notifyBoothAllMeetingsCancelled,
  notifyBoothMeetingAssigned,
  notifyBoothMeetingCancelled,
  notifyBoothMeetingReassignedAway,
  notifyBoothMeetingSlotRemoved,
  notifyBoothMeetingUpdated,
} from '../../../lib/boothMeetingNotify';
import {
  b2bPickerDateToUtcIso,
  b2bUtcIsoToPickerDate,
  formatB2BSlotRangeWallClock,
  formatB2BWhenLabelWallClock,
} from '../../../lib/b2bEventTime';
import {
  fetchVendorPriorInteractionFlags,
  type VendorPriorInteractionFlag,
} from '../../../lib/vendorAttendeeBrief';
import VendorAttendeeBriefModal from '../../../components/VendorAttendeeBriefModal';
import { colors } from '../../../constants/colors';
import type { VendorBooth, MeetingSlot, MeetingBooking, MeetingBookingStatus } from '../../../lib/types';

type SlotWithBooking = MeetingSlot & {
  myBooking?: MeetingBooking | null;
  bookings?: (MeetingBooking & { attendee_name?: string })[];
};

export default function BoothDetailScreen() {
  const params = useLocalSearchParams<{ boothId: string; from?: string; rate_slot_id?: string }>();
  const boothId = typeof params.boothId === 'string' ? params.boothId : Array.isArray(params.boothId) ? params.boothId[0] : undefined;
  const from = typeof params.from === 'string' ? params.from : Array.isArray(params.from) ? params.from[0] : undefined;
  const rateSlotId = typeof params.rate_slot_id === 'string' ? params.rate_slot_id : Array.isArray(params.rate_slot_id) ? params.rate_slot_id[0] : undefined;
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  /** Fixed cap so the rate modal ScrollView always has a bounded height and scrolls reliably (avoids % + flex quirks). */
  const rateModalMaxH = Math.round(windowHeight * 0.86);
  const rateModalOpenedFromParamRef = useRef(false);

  const goBack = useCallback(() => {
    const returnPath = from && typeof from === 'string' ? decodeURIComponent(from).trim() : null;
    if (returnPath) {
      router.replace(returnPath as any);
    } else {
      router.back();
    }
  }, [from, router]);
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const b2bEventTz = currentEvent?.reminder_timezone;
  const vendorBriefEnabled = currentEvent?.vendor_brief_enabled !== false;
  const [booth, setBooth] = useState<VendorBooth | null>(null);
  const [slots, setSlots] = useState<SlotWithBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bookingActionId, setBookingActionId] = useState<string | null>(null);
  /** Event admin, platform admin, or rep/contact for this booth only — not every member with a vendor role in the event. */
  const [canViewAllMeetings, setCanViewAllMeetings] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [eventMembers, setEventMembers] = useState<{ user_id: string; full_name: string }[]>([]);
  const [assignAttendeeId, setAssignAttendeeId] = useState<string | null>(null);
  const [assignDateTime, setAssignDateTime] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [assignEndDateTime, setAssignEndDateTime] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 30, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [attendeeDropdownOpen, setAttendeeDropdownOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editSlot, setEditSlot] = useState<SlotWithBooking | null>(null);
  const [editBooking, setEditBooking] = useState<(MeetingBooking & { attendee_name?: string }) | null>(null);
  const [editDateTime, setEditDateTime] = useState<Date>(() => new Date());
  const [editEndDateTime, setEditEndDateTime] = useState<Date>(() => new Date());
  const [editAttendeeId, setEditAttendeeId] = useState<string | null>(null);
  const [editAttendeeDropdownOpen, setEditAttendeeDropdownOpen] = useState(false);
  const [editShowDatePicker, setEditShowDatePicker] = useState(false);
  const [editShowTimePicker, setEditShowTimePicker] = useState(false);
  const [editShowEndDatePicker, setEditShowEndDatePicker] = useState(false);
  const [editShowEndTimePicker, setEditShowEndTimePicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelAlling, setCancelAlling] = useState(false);
  const [feedbackBookingIds, setFeedbackBookingIds] = useState<Set<string>>(new Set());
  const [feedbackSlotIds, setFeedbackSlotIds] = useState<Set<string>>(new Set());
  const [feedbackTimeKeys, setFeedbackTimeKeys] = useState<Set<string>>(new Set());
  const [rateModalBooking, setRateModalBooking] = useState<MeetingBooking | null>(null);
  const [rateModalSlot, setRateModalSlot] = useState<SlotWithBooking | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<number>(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackMeetAgain, setFeedbackMeetAgain] = useState<boolean | null>(null);
  const [feedbackRecommend, setFeedbackRecommend] = useState<boolean | null>(null);
  const [feedbackWorkWith, setFeedbackWorkWith] = useState<number>(0);
  const [savingFeedback, setSavingFeedback] = useState(false);
  /** All reps + primary contact for this booth (visible to everyone visiting the booth). */
  const [boothReps, setBoothReps] = useState<BoothRepresentative[]>([]);
  /** Vendor-only: "met before" flags per attendee (company-wide, prior events). */
  const [priorFlags, setPriorFlags] = useState<Map<string, VendorPriorInteractionFlag>>(new Map());
  const [briefModalVisible, setBriefModalVisible] = useState(false);
  const [briefSubjectId, setBriefSubjectId] = useState<string | null>(null);
  const [briefName, setBriefName] = useState('');
  const [briefMeetings, setBriefMeetings] = useState<{ start: string; end: string }[]>([]);

  const fetchRepBoothIds = useCallback(async (eventId: string, uid: string, client: typeof supabase) => {
    const repsRes = await client
      .from('vendor_booth_reps')
      .select('booth_id, vendor_booths!inner(event_id)')
      .eq('user_id', uid)
      .eq('vendor_booths.event_id', eventId);
    if (!repsRes.error) {
      return (repsRes.data ?? []).map((r: { booth_id: string }) => r.booth_id);
    }
    const legacy = await client
      .from('vendor_booths')
      .select('id')
      .eq('event_id', eventId)
      .eq('contact_user_id', uid);
    return (legacy.data ?? []).map((b: { id: string }) => b.id);
  }, []);

  const fetchBoothAndSlots = useCallback(async () => {
    if (!boothId) {
      setBooth(null);
      setSlots([]);
      setBoothReps([]);
      setLoading(false);
      return;
    }
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    setLoading(true);
    try {
      const boothRes = await client
        .from('vendor_booths')
        .select('*')
        .eq('id', boothId)
        .eq('is_active', true)
        .maybeSingle();

      if (boothRes.error || !boothRes.data) {
        setBooth(null);
        setSlots([]);
        setBoothReps([]);
        setLoading(false);
        return;
      }

      const boothData = boothRes.data as VendorBooth & { contact_user_id?: string | null };
      const activeEventId = useEventStore.getState().currentEvent?.id;
      if (boothData.event_id !== activeEventId) {
        const switched = await ensureCurrentEventForId(boothData.event_id, user?.is_platform_admin === true);
        if (!switched) {
          setBooth(null);
          setSlots([]);
          setBoothReps([]);
          setLoading(false);
          router.replace('/(tabs)/expo' as any);
          return;
        }
      }

      const eventId = useEventStore.getState().currentEvent?.id;
      if (!eventId) {
        return;
      }

      const [slotsRes, roleRes, bookingsRes, myRepBoothIds] = await Promise.all([
        client.from('meeting_slots').select('id, booth_id, start_time, end_time, is_available, created_at').eq('booth_id', boothId).order('start_time', { ascending: true }),
        user?.id ? client.from('event_members').select('role, roles').eq('event_id', eventId).eq('user_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
        user?.id ? client.from('meeting_bookings').select('id, slot_id, attendee_id, status, notes, created_at').eq('attendee_id', user.id) : Promise.resolve({ data: [] }),
        user?.id ? fetchRepBoothIds(eventId, user.id, client) : Promise.resolve([] as string[]),
      ]);

      const roleRow = roleRes.data as { role?: string; roles?: string[] } | null;
      const roles = Array.isArray(roleRow?.roles) ? roleRow.roles : [];
      const role = roleRow?.role ?? roles[0];
      const isEventAdmin =
        user?.is_platform_admin === true ||
        role === 'admin' ||
        role === 'super_admin' ||
        roles.includes('admin') ||
        roles.includes('super_admin');

      const isVendorRepOfSomeBooth = myRepBoothIds.length > 0;
      const isVendorRepOfThisBooth = myRepBoothIds.includes(boothData.id);
      if (isVendorRepOfSomeBooth && !isVendorRepOfThisBooth && !isEventAdmin) {
        setBooth(null);
        setSlots([]);
        setBoothReps([]);
        setLoading(false);
        router.replace('/(tabs)/expo' as any);
        return;
      }
      setBooth(boothData);

      const isVendorRep = myRepBoothIds.includes(boothData.id);
      const canViewAllMeetingsThisBooth = isEventAdmin || isVendorRep;
      setCanViewAllMeetings(canViewAllMeetingsThisBooth);
      setIsAdmin(isEventAdmin);

      const slotsData = (slotsRes.data ?? []) as MeetingSlot[];
      const myBookings = (bookingsRes.data ?? []) as MeetingBooking[];
      const myBySlot = new Map(myBookings.map((b) => [b.slot_id, b]));

      if (user?.id && slotsData.length > 0) {
        const slotIdsForBooth = slotsData.map((s) => s.id);
        const { data: feedbackRows, error: feedbackErr } = await client
          .from('b2b_meeting_feedback')
          .select('booking_id, meeting_bookings!inner(slot_id, meeting_slots!inner(booth_id, start_time, end_time))')
          .eq('user_id', user.id)
          .in('meeting_bookings.slot_id', slotIdsForBooth);

        if (feedbackErr) {
          if (__DEV__) console.warn('B2B feedback lookup error:', feedbackErr.message);
          setFeedbackBookingIds(new Set());
          setFeedbackSlotIds(new Set());
          setFeedbackTimeKeys(new Set());
        } else {
          const bookingIds = new Set<string>();
          const ratedSlotIds = new Set<string>();
          const ratedTimeKeys = new Set<string>();
          for (const row of feedbackRows ?? []) {
            const r = row as {
              booking_id?: string | null;
              meeting_bookings?: {
                slot_id?: string | null;
                meeting_slots?: {
                  booth_id?: string | null;
                  start_time?: string | null;
                  end_time?: string | null;
                } | null;
              } | null;
            };
            const bookingId = r.booking_id ?? '';
            if (bookingId) bookingIds.add(bookingId);
            const slotId = r.meeting_bookings?.slot_id ?? '';
            if (slotId) ratedSlotIds.add(slotId);
            const ms = r.meeting_bookings?.meeting_slots;
            if (ms?.booth_id === boothId && ms.start_time && ms.end_time) {
              ratedTimeKeys.add(`${ms.start_time}|${ms.end_time}`);
            }
          }
          setFeedbackBookingIds(bookingIds);
          setFeedbackSlotIds(ratedSlotIds);
          setFeedbackTimeKeys(ratedTimeKeys);
        }
      } else {
        setFeedbackBookingIds(new Set());
        setFeedbackSlotIds(new Set());
        setFeedbackTimeKeys(new Set());
      }

      if (canViewAllMeetingsThisBooth && slotsData.length > 0) {
        const slotIds = slotsData.map((s) => s.id);
        const { data: allBookings } = await client.from('meeting_bookings').select('id, slot_id, attendee_id, status, notes, created_at').in('slot_id', slotIds);
        const bookingsList = (allBookings ?? []) as MeetingBooking[];
        const attendeeIds = [...new Set(bookingsList.map((b) => b.attendee_id))];
        const { data: usersData } = attendeeIds.length > 0 ? await client.from('users').select('id, full_name').in('id', attendeeIds) : { data: [] };
        const nameByUserId = new Map((usersData ?? []).map((u: { id: string; full_name: string }) => [u.id, u.full_name ?? '']));
        const bySlot = new Map<string, (MeetingBooking & { attendee_name?: string })[]>();
        for (const b of bookingsList) {
          const arr = bySlot.get(b.slot_id) ?? [];
          arr.push({ ...b, attendee_name: nameByUserId.get(b.attendee_id) ?? undefined });
          bySlot.set(b.slot_id, arr);
        }
        setSlots(
          slotsData.map((slot) => ({
            ...slot,
            myBooking: myBySlot.get(slot.id) ?? null,
            bookings: bySlot.get(slot.id) ?? [],
          }))
        );
        const activeAttendeeIds = [
          ...new Set(bookingsList.filter((b) => b.status !== 'cancelled').map((b) => b.attendee_id)),
        ];
        const briefEnabled = useEventStore.getState().currentEvent?.vendor_brief_enabled !== false;
        if (briefEnabled && activeAttendeeIds.length > 0) {
          fetchVendorPriorInteractionFlags(eventId, activeAttendeeIds)
            .then((flags) => setPriorFlags(flags))
            .catch(() => setPriorFlags(new Map()));
        } else {
          setPriorFlags(new Map());
        }
      } else {
        setSlots(
          slotsData.map((slot) => ({
            ...slot,
            myBooking: myBySlot.get(slot.id) ?? null,
            bookings: [],
          }))
        );
        setPriorFlags(new Map());
      }

      try {
        const reps = await fetchBoothRepresentatives(
          { id: boothData.id, contact_user_id: boothData.contact_user_id ?? null },
          client
        );
        setBoothReps(reps);
      } catch {
        setBoothReps([]);
      }
    } catch (e) {
      console.error('Booth detail fetch error:', e);
      setBooth(null);
      setSlots([]);
      setBoothReps([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [boothId, currentEvent?.id, user?.id, fetchRepBoothIds]);

  useEffect(() => {
    if (boothId === undefined || boothId === '' || (typeof boothId === 'string' && boothId.startsWith('['))) {
      router.replace('/(tabs)/expo' as any);
    }
  }, [boothId, router]);

  useFocusEffect(
    useCallback(() => {
      if (boothId) {
        setLoading(true);
        fetchBoothAndSlots();
      }
    }, [boothId, currentEvent?.id, fetchBoothAndSlots])
  );

  useEffect(() => {
    if (!isAdmin || !currentEvent?.id) return;
    let cancelled = false;
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    (async () => {
      const { data } = await client
        .from('event_members')
        .select('user_id, users!inner(full_name)')
        .eq('event_id', currentEvent.id)
        .neq('role', 'super_admin');
      if (cancelled) return;
      type MemberRow = { user_id: string; users: { full_name: string } | { full_name: string }[] | null };
      const rows = (data ?? []) as MemberRow[];
      setEventMembers(rows.map((r) => ({
        user_id: r.user_id,
        full_name: Array.isArray(r.users) ? r.users[0]?.full_name : r.users?.full_name ?? 'Unknown',
      })));
    })();
    return () => { cancelled = true; };
  }, [isAdmin, currentEvent?.id]);

  useEffect(() => {
    if (!boothId || !canViewAllMeetings) return;
    let cancelled = false;
    const refetch = () => { if (!cancelled) fetchBoothAndSlots(); };
    const t = setInterval(refetch, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [boothId, canViewAllMeetings, fetchBoothAndSlots]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchBoothAndSlots();
  };

  const ASSIGN_TIMEOUT_MS = 20_000;
  const withAssignTimeout = <T,>(p: Promise<T>, label: string): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out. Check your connection.`)), ASSIGN_TIMEOUT_MS))]);

  const assignMeeting = async () => {
    if (!isAdmin || !assignAttendeeId || !currentEvent?.id || !boothId) return;
    const startIso = b2bPickerDateToUtcIso(assignDateTime);
    const endIso = b2bPickerDateToUtcIso(assignEndDateTime);
    if (endIso <= startIso) {
      Alert.alert('Invalid time', 'End time must be after start time.');
      return;
    }
    setAssigning(true);
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      const { data: newSlot, error: slotErr } = await withAssignTimeout(
        Promise.resolve(client.from('meeting_slots').insert({ booth_id: boothId, start_time: startIso, end_time: endIso, is_available: true }).select('id').single()),
        'Create meeting time'
      );
      if (slotErr) throw slotErr;
      const finalSlotId = (newSlot as { id: string }).id;
      const { data: inserted, error } = await withAssignTimeout(
        Promise.resolve(client.from('meeting_bookings').insert({ slot_id: finalSlotId, attendee_id: assignAttendeeId, status: 'confirmed' }).select('id').single()),
        'Assign meeting'
      );
      if (error) throw error;
      if (inserted?.id) {
        await awardPoints(assignAttendeeId, currentEvent.id, 'vendor_meeting', inserted.id);
      }
      setAssignModalVisible(false);
      setAssignAttendeeId(null);
      setAttendeeDropdownOpen(false);
      setAssignDateTime((d) => {
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        next.setHours(9, 0, 0, 0);
        return next;
      });
      setAssignEndDateTime((d) => {
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        next.setHours(9, 30, 0, 0);
        return next;
      });
      await fetchBoothAndSlots();
      const vendorName = booth?.vendor_name ?? 'this vendor';
      const whenLabel = formatB2BWhenLabelWallClock(startIso);
      await notifyBoothMeetingAssigned(
        assignAttendeeId,
        currentEvent?.id ?? '',
        vendorName,
        boothId,
        whenLabel
      );
    } catch (e: unknown) {
      console.error('Assign meeting error:', e);
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Could not assign meeting.';
      Alert.alert(
        'Error',
        msg.includes('row-level security') || msg.includes('policy')
          ? 'Permission denied. Make sure the Supabase policy allows platform admins to insert meeting bookings (run `supabase/migrations/20260316000000_meeting_bookings_platform_admin.sql` or update RUN-THESE-MIGRATIONS.sql).'
          : msg
      );
    } finally {
      setAssigning(false);
    }
  };

  const formatSlotTime = (start: string, end: string) => formatB2BSlotRangeWallClock(start, end);

  const slotsToShow = canViewAllMeetings ? slots : slots.filter((s) => s.myBooking && s.myBooking.status !== 'cancelled');

  /** Vendor/admin: active or empty slots in main list; cancelled-only slots at bottom. */
  const meetingsMainSlots = canViewAllMeetings
    ? slotsToShow.filter((s) => {
        const bs = s.bookings ?? [];
        return bs.length === 0 || bs.some((b) => b.status !== 'cancelled');
      })
    : slotsToShow;
  const meetingsCancelledOnlySlots = canViewAllMeetings
    ? slotsToShow.filter((s) => {
        const bs = s.bookings ?? [];
        return bs.length > 0 && bs.every((b) => b.status === 'cancelled');
      })
    : [];

  // When opened from schedule "Tap to rate", open the rate modal for that slot if it's past and not yet rated.
  useEffect(() => {
    if (!rateSlotId || loading || canViewAllMeetings || rateModalOpenedFromParamRef.current) return;
    const slot = slots.find((s) => s.id === rateSlotId);
    if (!slot?.myBooking || slot.myBooking.status === 'cancelled') return;
    if (!isB2BSlotPastWallClock(slot.start_time, slot.end_time, b2bEventTz)) return;
    if (
      feedbackBookingIds.has(slot.myBooking.id) ||
      feedbackSlotIds.has(slot.id) ||
      feedbackTimeKeys.has(`${slot.start_time}|${slot.end_time}`)
    ) {
      return;
    }
    rateModalOpenedFromParamRef.current = true;
    setRateModalBooking(slot.myBooking);
    setRateModalSlot(slot);
    setFeedbackRating(0);
    setFeedbackComment('');
    setFeedbackMeetAgain(null);
    setFeedbackRecommend(null);
    setFeedbackWorkWith(0);
  }, [rateSlotId, loading, slots, canViewAllMeetings, feedbackBookingIds, feedbackSlotIds, feedbackTimeKeys, b2bEventTz]);

  // "Past" should mean the meeting already ended (now > end_time), not just that the start_time is earlier than now.
  // This fixes the "Live now" label being shown as "Past" once the clock passes the start.
  const slotInPast = (startTime: string, endTime?: string) =>
    isB2BSlotPastWallClock(startTime, endTime ?? startTime, b2bEventTz);

  const slotIsLive = (startTime: string, endTime: string) => {
    const start = parseSessionDate(startTime);
    const end = parseSessionDate(endTime);
    if (!start || !end) return false;
    const dateKey = getSessionDateKeyFromIso(startTime);
    if (!dateKey) return false;
    return isSessionLiveWallClockOnEventDay(new Date(), start, end, dateKey, b2bEventTz);
  };

  const clampToValidRange = (start: Date, end: Date) => {
    if (end.getTime() <= start.getTime()) return null;
    return { start, end };
  };

  const closeRateModal = () => {
    if (savingFeedback) return;
    rateModalOpenedFromParamRef.current = false;
    setRateModalBooking(null);
    setRateModalSlot(null);
    setFeedbackRating(0);
    setFeedbackComment('');
    setFeedbackMeetAgain(null);
    setFeedbackRecommend(null);
    setFeedbackWorkWith(0);
  };

  const cancelMeeting = async (bookingId: string) => {
    const slot = slots.find((s) => (s.bookings ?? []).some((b) => b.id === bookingId));
    const booking = slot?.bookings?.find((b) => b.id === bookingId);
    const attendeeId = booking?.attendee_id;
    const vendorName = booth?.vendor_name ?? 'this vendor';
    Alert.alert('Cancel meeting?', 'This will cancel this scheduled meeting for the attendee.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, cancel',
        style: 'destructive',
        onPress: async () => {
          const client = Platform.OS === 'android' ? supabaseStorage : supabase;
          try {
            const { error } = await withAssignTimeout(
        Promise.resolve(client.from('meeting_bookings').update({ status: 'cancelled' }).eq('id', bookingId)),
              'Cancel meeting'
            );
            if (error) throw error;
            await fetchBoothAndSlots();
            if (attendeeId && currentEvent?.id && boothId) {
              const whenLabel = slot
                ? formatSlotTime(slot.start_time, slot.end_time)
                : undefined;
              await notifyBoothMeetingCancelled(
                attendeeId,
                currentEvent.id,
                vendorName,
                boothId,
                booking?.attendee_name,
                whenLabel
              );
            }
          } catch (e: unknown) {
            const err = e as { message?: string } | null;
            const msg = err && typeof err.message === 'string' ? err.message : 'Could not cancel meeting.';
            const isPermission = /policy|permission|row-level security|RLS|42501|42502/i.test(msg);
            Alert.alert(
              'Error',
              isPermission
                ? 'Only event admins can cancel meetings. Try signing out and back in, then try again.'
                : msg
            );
          }
        },
      },
    ]);
  };

  const deleteSlotPermanently = (slotId: string) => {
    Alert.alert(
      'Delete time slot?',
      'This permanently removes this time window and any booking on it (including cancelled). This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const client = Platform.OS === 'android' ? supabaseStorage : supabase;
            const slot = slots.find((s) => s.id === slotId);
            const activeBooking = slot?.bookings?.find((b) => b.status !== 'cancelled');
            const vendorName = booth?.vendor_name ?? 'this vendor';
            try {
              if (activeBooking && currentEvent?.id && boothId) {
                const whenLabel = slot ? formatSlotTime(slot.start_time, slot.end_time) : undefined;
                await notifyBoothMeetingSlotRemoved(
                  activeBooking.attendee_id,
                  currentEvent.id,
                  vendorName,
                  boothId,
                  activeBooking.attendee_name,
                  whenLabel
                );
              }
              const { error } = await withAssignTimeout(
                Promise.resolve(client.from('meeting_slots').delete().eq('id', slotId)),
                'Delete time slot'
              );
              if (error) throw error;
              await fetchBoothAndSlots();
            } catch (e: unknown) {
              const msg =
                e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Could not delete slot.';
              const isPermission = /policy|permission|row-level security|RLS|42501|42502/i.test(msg);
              Alert.alert(
                'Error',
                isPermission
                  ? 'You may not have permission to remove this slot. Try signing out and back in, or ask an event admin.'
                  : msg
              );
            }
          },
        },
      ]
    );
  };

  const cancelAllMeetings = () => {
    const activeSlots = slots.filter((s) => (s.bookings?.length ?? 0) > 0 && (s.bookings ?? []).some((b) => b.status !== 'cancelled'));
    if (activeSlots.length === 0) {
      Alert.alert('No meetings', 'There are no scheduled meetings to cancel.');
      return;
    }
    Alert.alert(
      'Cancel all meetings for this booth?',
      'This will cancel every scheduled meeting for this vendor. Attendees will no longer see this booth in their list.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, cancel all',
          style: 'destructive',
          onPress: async () => {
            const attendeeIds = [...new Set(slots.flatMap((s) => (s.bookings ?? []).filter((b) => b.status !== 'cancelled').map((b) => b.attendee_id)))];
            const vendorName = booth?.vendor_name ?? 'this vendor';
            setCancelAlling(true);
            const client = Platform.OS === 'android' ? supabaseStorage : supabase;
            try {
              const slotIds = slots.map((s) => s.id);
              const updatePromise = (async () => {
                const CHUNK = 50;
                for (let i = 0; i < slotIds.length; i += CHUNK) {
                  const chunk = slotIds.slice(i, i + CHUNK);
                  const { error } = await client
                    .from('meeting_bookings')
                    .update({ status: 'cancelled' })
                    .in('slot_id', chunk)
                    .neq('status', 'cancelled');
                  if (error) throw error;
                }
              })();
              await withAssignTimeout(updatePromise, 'Cancel all meetings');
              await fetchBoothAndSlots();
              if (currentEvent?.id && boothId) {
                for (const uid of attendeeIds) {
                  await notifyBoothMeetingCancelled(uid, currentEvent.id, vendorName, boothId);
                }
                await notifyBoothAllMeetingsCancelled(currentEvent.id, boothId);
              }
              Alert.alert('Done', 'All meetings for this booth have been cancelled.');
            } catch (e: unknown) {
              const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Could not cancel meetings.';
              const isPermission = /policy|permission|row-level security|RLS|42501|42502/i.test(msg);
              Alert.alert(
                'Error',
                isPermission
                  ? 'Only event admins can cancel meetings. If you are an admin, try signing out and back in, then try again.'
                  : msg
              );
            } finally {
              setCancelAlling(false);
            }
          },
        },
      ]
    );
  };

  const openEditMeeting = (slot: SlotWithBooking, booking: MeetingBooking & { attendee_name?: string }) => {
    try {
      const start = b2bUtcIsoToPickerDate(slot.start_time);
      const end = b2bUtcIsoToPickerDate(slot.end_time);
      if (!start || !end) throw new Error('invalid time');
      setEditSlot(slot);
      setEditBooking(booking);
      setEditDateTime(start);
      setEditEndDateTime(end);
      setEditAttendeeId(booking.attendee_id);
      setEditAttendeeDropdownOpen(false);
      setEditShowDatePicker(false);
      setEditShowTimePicker(false);
      setEditShowEndDatePicker(false);
      setEditShowEndTimePicker(false);
      setEditModalVisible(true);
    } catch {
      Alert.alert('Error', 'Could not open edit.');
    }
  };

  const saveEditMeeting = async () => {
    if (!editSlot || !editBooking || !editAttendeeId) return;
    const startIso = b2bPickerDateToUtcIso(editDateTime);
    const endIso = b2bPickerDateToUtcIso(editEndDateTime);
    if (endIso <= startIso) {
      Alert.alert('Error', 'End time must be after start time.');
      return;
    }
    setEditing(true);
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      const { error: slotErr } = await withAssignTimeout(
        Promise.resolve(client.from('meeting_slots').update({ start_time: startIso, end_time: endIso }).eq('id', editSlot.id)),
        'Update meeting time'
      );
      if (slotErr) throw slotErr;
      const { error: bookErr } = await withAssignTimeout(
        Promise.resolve(client.from('meeting_bookings').update({ attendee_id: editAttendeeId }).eq('id', editBooking.id)),
        'Update attendee'
      );
      if (bookErr) throw bookErr;
      setEditModalVisible(false);
      const vendorName = booth?.vendor_name ?? 'this vendor';
      const whenLabel = formatB2BWhenLabelWallClock(startIso);
      const previousAttendeeId = editBooking.attendee_id;
      const previousAttendeeName = editBooking.attendee_name;
      setEditSlot(null);
      setEditBooking(null);
      await fetchBoothAndSlots();
      if (currentEvent?.id && boothId) {
        if (previousAttendeeId !== editAttendeeId) {
          await notifyBoothMeetingReassignedAway(
            previousAttendeeId,
            currentEvent.id,
            vendorName,
            boothId
          );
          await notifyBoothMeetingAssigned(
            editAttendeeId,
            currentEvent.id,
            vendorName,
            boothId,
            whenLabel
          );
        } else {
          await notifyBoothMeetingUpdated(
            editAttendeeId,
            currentEvent.id,
            vendorName,
            boothId,
            whenLabel,
            previousAttendeeName
          );
        }
      }
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Could not save changes.';
      Alert.alert('Error', msg);
    } finally {
      setEditing(false);
    }
  };

  const openWebsite = (url: string | null) => {
    if (!url?.trim()) return;
    const u = url.startsWith('http') ? url : `https://${url}`;
    Linking.openURL(u).catch(() => {});
  };

  const openAttendeeBrief = useCallback(
    (attendeeId: string, attendeeName?: string, meetingTimes?: { start: string; end: string }[]) => {
      setBriefSubjectId(attendeeId);
      setBriefName(attendeeName ?? '');
      setBriefMeetings(meetingTimes ?? []);
      setBriefModalVisible(true);
    },
    []
  );

  const closeBriefModal = () => {
    setBriefModalVisible(false);
    setBriefSubjectId(null);
    setBriefName('');
    setBriefMeetings([]);
  };

  if (!boothId || boothId === '' || (typeof boothId === 'string' && boothId.startsWith('['))) {
    return null;
  }

  if (loading && !booth) {
    return (
      <SafeAreaView style={s.container} edges={[]}>
        <View style={s.header}>
          <TouchableOpacity onPress={goBack} style={s.headerBack}>
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Booth</Text>
        </View>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!booth) {
    return (
      <SafeAreaView style={s.container} edges={[]}>
        <View style={s.header}>
          <TouchableOpacity onPress={goBack} style={s.headerBack}>
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Booth</Text>
        </View>
        <View style={s.centered}>
          <Text style={s.emptyText}>Booth not found.</Text>
          <TouchableOpacity onPress={goBack} style={s.backBtn}>
            <Text style={s.backBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const myMeetingSlot = !canViewAllMeetings && slotsToShow.length > 0 ? slotsToShow[0] : null;

  return (
    <SafeAreaView style={s.container} edges={[]}>
      <View style={s.header}>
<TouchableOpacity onPress={goBack} style={s.headerBack}>
        <ChevronLeft size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>Booth</Text>
    </View>
    <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={s.heroSection}>
          {booth.logo_url ? (
            <Image source={{ uri: booth.logo_url }} style={s.boothHeroLogo} resizeMode="contain" />
          ) : (
            <View style={s.boothHeroLogoPlaceholder}>
              <Store size={48} color={colors.textMuted} />
            </View>
          )}
          <Text style={s.boothDetailVendorNameHero}>{booth.vendor_name}</Text>
        </View>

        <View style={s.detailCard}>
          {booth.description ? (
            <>
              <Text style={s.detailSectionLabel}>About</Text>
              <Text style={s.boothDetailDescription}>{booth.description}</Text>
            </>
          ) : null}
          {booth.booth_location ? (
            <View style={s.detailMetaRow}>
              <MapPin size={18} color={colors.primary} />
              <Text style={s.detailMetaText}>{booth.booth_location}</Text>
            </View>
          ) : null}
          {booth.website ? (
            <TouchableOpacity style={s.websiteBtn} onPress={() => openWebsite(booth.website)}>
              <ExternalLink size={18} color={colors.primary} />
              <Text style={s.websiteText}>Visit website</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {boothReps.length > 0 ? (
          <View style={s.detailCard}>
            <Text style={s.detailSectionLabel}>Representatives</Text>
            {boothReps.map((r) => (
              <TouchableOpacity
                key={r.user_id}
                style={s.repRow}
                activeOpacity={0.75}
                onPress={() => router.push(`/(tabs)/feed/user/${r.user_id}` as any)}
              >
                <Text style={s.repRowName}>
                  {r.full_name}
                </Text>
                {r.title || r.company ? (
                  <Text style={s.repRowSubtitle}>{[r.title, r.company].filter(Boolean).join(' · ')}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {myMeetingSlot ? (
          <View style={s.yourMeetingCard}>
            <Text style={s.yourMeetingTitle}>Your meeting</Text>
            <View style={s.yourMeetingRow}>
              <Calendar size={20} color={colors.primary} />
              <Text style={s.yourMeetingTime}>{formatSlotTime(myMeetingSlot.start_time, myMeetingSlot.end_time)}</Text>
            </View>
            {booth.booth_location ? (
              <View style={s.yourMeetingRow}>
                <MapPin size={20} color={colors.primary} />
                <Text style={s.yourMeetingLocation}>{booth.booth_location}</Text>
              </View>
            ) : null}
            {myMeetingSlot.myBooking?.status ? (
              <Text style={s.yourMeetingStatus}>
                {myMeetingSlot.myBooking.status === 'confirmed' ? 'Confirmed' : myMeetingSlot.myBooking.status === 'requested' ? 'Requested' : myMeetingSlot.myBooking.status === 'declined' ? 'Declined' : myMeetingSlot.myBooking.status}
              </Text>
            ) : null}
            {boothReps.length > 0 ? (
              <MeetingRepresentatives representatives={boothReps} variant="full" label="Your representative(s)" />
            ) : null}
            {slotInPast(myMeetingSlot.start_time, myMeetingSlot.end_time) && myMeetingSlot.myBooking ? (
              feedbackBookingIds.has(myMeetingSlot.myBooking.id) ||
              feedbackSlotIds.has(myMeetingSlot.id) ||
              feedbackTimeKeys.has(`${myMeetingSlot.start_time}|${myMeetingSlot.end_time}`) ? (
                <View style={s.ratedMeetingRow}>
                  <CheckCircle size={20} color={colors.primary} />
                  <Text style={s.ratedMeetingText}>Already rated</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={s.rateMeetingBtn}
                  onPress={() => {
                    setRateModalBooking(myMeetingSlot.myBooking!);
                    setRateModalSlot(myMeetingSlot);
                    setFeedbackRating(0);
                    setFeedbackComment('');
                    setFeedbackMeetAgain(null);
                    setFeedbackRecommend(null);
                    setFeedbackWorkWith(0);
                  }}
                >
                  <Star size={18} color={colors.primary} />
                  <Text style={s.rateMeetingBtnText}>Rate this meeting</Text>
                </TouchableOpacity>
              )
            ) : null}
          </View>
        ) : null}

        {(canViewAllMeetings || !myMeetingSlot) ? (
        <View style={s.sectionContent}>
        <Text style={s.sectionTitle}>{canViewAllMeetings ? 'Meetings' : 'Meeting details'}</Text>
        {isAdmin && (
          <View style={s.adminActionsRow}>
            <TouchableOpacity
              style={s.assignBtn}
              onPress={() => {
                setAssignAttendeeId(null);
                if (currentEvent?.start_date) {
                  const [y, m, d] = currentEvent.start_date.split('-').map(Number);
                  const dMin = new Date(y, (m ?? 1) - 1, d ?? 1, 9, 0, 0, 0);
                  if (!isNaN(dMin.getTime())) {
                    setAssignDateTime(dMin);
                    const dEnd = new Date(dMin.getTime() + 30 * 60 * 1000);
                    setAssignEndDateTime(dEnd);
                  }
                } else {
                  const d = new Date();
                  d.setDate(d.getDate() + 1);
                  d.setHours(9, 0, 0, 0);
                  setAssignDateTime(d);
                  const dEnd = new Date(d.getTime() + 30 * 60 * 1000);
                  setAssignEndDateTime(dEnd);
                }
                setAssignModalVisible(true);
              }}
            >
              <UserPlus size={20} color="#fff" />
              <Text style={s.assignBtnText}>Assign meeting</Text>
            </TouchableOpacity>
            {slots.some((s) => (s.bookings ?? []).some((b) => b.status !== 'cancelled')) && (
              <TouchableOpacity style={s.cancelAllBtn} onPress={cancelAllMeetings} disabled={cancelAlling}>
                {cancelAlling ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={s.cancelAllBtnText}>Cancel all meetings</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}
        {slotsToShow.length === 0 ? (
          <Text style={s.noSlots}>{isAdmin ? 'No meetings yet. Tap "Assign meeting" to add one.' : 'No meeting assigned to you yet.'}</Text>
        ) : (
          <>
            {(() => {
              const upcoming = meetingsMainSlots.filter((s) => !slotInPast(s.start_time, s.end_time));
              const past = meetingsMainSlots.filter((s) => slotInPast(s.start_time, s.end_time));
              const statusLabel: Record<MeetingBookingStatus, string> = {
                requested: 'Requested',
                confirmed: 'Confirmed',
                declined: 'Declined',
                cancelled: 'Cancelled',
              };
              const renderSlot = (slot: (typeof slotsToShow)[0], variant: 'default' | 'cancelledSection' = 'default') => {
                const isCancelledSection = variant === 'cancelledSection';
                const isPast = slotInPast(slot.start_time, slot.end_time);
                const liveNow = isAdmin && !isCancelledSection && slotIsLive(slot.start_time, slot.end_time);
                const myBooking = slot.myBooking;
                const orderedBookings = [...(slot.bookings ?? [])].sort((a, b) => {
                  const ca = a.status === 'cancelled' ? 1 : 0;
                  const cb = b.status === 'cancelled' ? 1 : 0;
                  return ca - cb;
                });
                return (
                  <View
                    key={slot.id}
                    style={[s.slotCard, isPast && !isCancelledSection && s.slotCardPast, isCancelledSection && s.slotCardCancelled]}
                  >
                    <View style={s.slotRow}>
                      <Calendar size={18} color={isPast || isCancelledSection ? colors.textMuted : colors.primary} />
                      <Text style={[s.slotTime, isCancelledSection && s.slotTimeMuted]}>{formatSlotTime(slot.start_time, slot.end_time)}</Text>
                      {isCancelledSection ? (
                        <Text style={s.cancelledBadge}>Cancelled</Text>
                      ) : isPast ? (
                        <Text style={s.pastBadge}>Past</Text>
                      ) : liveNow ? (
                        <Text style={s.liveBadge}>Live now</Text>
                      ) : (
                        <Text style={s.upcomingBadge}>Upcoming</Text>
                      )}
                    </View>
                    {booth.booth_location ? (
                      <View style={s.slotLocationRow}>
                        <MapPin size={14} color={colors.textMuted} />
                        <Text style={s.slotLocationText}>{booth.booth_location}</Text>
                      </View>
                    ) : null}
                    {!canViewAllMeetings && myBooking && myBooking.status !== 'cancelled' && (
                      <>
                        <Text style={s.statusText}>Your meeting: {statusLabel[myBooking.status]}</Text>
                        {isPast &&
                          (feedbackBookingIds.has(myBooking.id) ||
                          feedbackSlotIds.has(slot.id) ||
                          feedbackTimeKeys.has(`${slot.start_time}|${slot.end_time}`) ? (
                            <View style={s.ratedMeetingRow}>
                              <CheckCircle size={18} color={colors.primary} />
                              <Text style={s.ratedMeetingText}>Already rated</Text>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={s.rateMeetingBtn}
                              onPress={() => {
                                setRateModalBooking(myBooking);
                                setRateModalSlot(slot);
                                setFeedbackRating(0);
                                setFeedbackComment('');
                                setFeedbackMeetAgain(null);
                                setFeedbackRecommend(null);
                                setFeedbackWorkWith(0);
                              }}
                            >
                              <Star size={18} color={colors.primary} />
                              <Text style={s.rateMeetingBtnText}>Rate this meeting</Text>
                            </TouchableOpacity>
                          ))}
                      </>
                    )}
                    {canViewAllMeetings && orderedBookings.length > 0 && (
                      <View style={s.bookingsList}>
                        {orderedBookings.map((b) => {
                          const flag = priorFlags.get(b.attendee_id);
                          const metBefore = vendorBriefEnabled && !!flag && (flag.prior_meetings_count + flag.prior_notes_count) > 0;
                          return (
                          <View key={b.id} style={s.bookingRow}>
                            <TouchableOpacity
                              style={s.bookingRowLeft}
                              activeOpacity={0.7}
                              disabled={b.status === 'cancelled'}
                              onPress={() => openAttendeeBrief(b.attendee_id, b.attendee_name, [{ start: slot.start_time, end: slot.end_time }])}
                            >
                              <View style={s.bookingNameCol}>
                                <View style={s.bookingNameRow}>
                                  <Text style={[s.bookingAttendee, b.status === 'cancelled' && s.bookingTextMuted]}>
                                    {b.attendee_name ?? `Attendee #${b.attendee_id.slice(0, 8)}…`}
                                  </Text>
                                  {b.status !== 'cancelled' && <Text style={s.viewBriefHint}>View</Text>}
                                </View>
                                {b.status !== 'cancelled' && metBefore ? (
                                  <View style={s.metBeforeChip}>
                                    <History size={12} color={colors.primary} />
                                    <Text style={s.metBeforeChipText} numberOfLines={1}>
                                      Prior interaction{flag?.last_event_name ? ` · ${flag.last_event_name}` : ''}
                                    </Text>
                                  </View>
                                ) : null}
                                <Text style={[s.bookingStatus, b.status === 'cancelled' && s.bookingTextMuted]}>{statusLabel[b.status]}</Text>
                              </View>
                            </TouchableOpacity>
                            {isAdmin && b.status !== 'cancelled' && (
                              <View style={s.bookingActions}>
                                <TouchableOpacity onPress={() => openEditMeeting(slot, b)} style={s.bookingActionBtn}>
                                  <Text style={s.bookingActionEdit}>Edit</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => cancelMeeting(b.id)} style={s.bookingActionBtn}>
                                  <Text style={s.bookingActionCancel}>Cancel</Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                          );
                        })}
                      </View>
                    )}
                    {canViewAllMeetings && isCancelledSection && (
                      <TouchableOpacity style={s.deleteSlotBtn} onPress={() => deleteSlotPermanently(slot.id)}>
                        <Text style={s.deleteSlotBtnText}>Delete time slot</Text>
                      </TouchableOpacity>
                    )}
                    {canViewAllMeetings && !isCancelledSection && orderedBookings.length === 0 && (
                      <TouchableOpacity style={s.deleteSlotBtn} onPress={() => deleteSlotPermanently(slot.id)}>
                        <Text style={s.deleteSlotBtnText}>Remove empty slot</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              };
              return (
                <>
                  {upcoming.length > 0 && (
                    <>
                      <Text style={s.subsectionTitle}>Upcoming</Text>
                      {upcoming.map((sl) => renderSlot(sl, 'default'))}
                    </>
                  )}
                  {past.length > 0 && (
                    <>
                      <Text style={s.subsectionTitle}>Past</Text>
                      {past.map((sl) => renderSlot(sl, 'default'))}
                    </>
                  )}
                  {meetingsCancelledOnlySlots.length > 0 && (
                    <>
                      <Text style={[s.subsectionTitle, s.subsectionTitleCancelled]}>Cancelled meetings</Text>
                      {meetingsCancelledOnlySlots.map((sl) => renderSlot(sl, 'cancelledSection'))}
                    </>
                  )}
                </>
              );
            })()}
          </>
        )}
        </View>
        ) : null}
      </ScrollView>

      {isAdmin && (
        <Modal visible={assignModalVisible} animationType="slide" transparent>
          <Pressable style={s.modalOverlay} onPress={() => !assigning && setAssignModalVisible(false)}>
            <Pressable style={s.modalContent} onPress={(e) => e.stopPropagation()}>
              <ScrollView
                style={s.modalScroll}
                contentContainerStyle={s.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                <Text style={s.modalTitle}>Assign meeting</Text>
                <Text style={s.modalSub}>Choose who to meet and when.</Text>

                <View style={s.modalSection}>
                  <Text style={s.modalSectionLabel}>1. Attendee</Text>
                  <TouchableOpacity
                    style={s.dropdownTrigger}
                    onPress={() => setAttendeeDropdownOpen(!attendeeDropdownOpen)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.dropdownTriggerText, !assignAttendeeId && s.dropdownPlaceholder]}>
                      {assignAttendeeId ? (eventMembers.find((m) => m.user_id === assignAttendeeId)?.full_name ?? 'Unknown') : 'Select attendee'}
                    </Text>
                    <ChevronDown size={20} color={colors.textMuted} style={{ transform: [{ rotate: attendeeDropdownOpen ? '180deg' : '0deg' }] }} />
                  </TouchableOpacity>
                  {attendeeDropdownOpen && (
                    <ScrollView
                      style={s.memberListWrap}
                      contentContainerStyle={s.memberListContent}
                      nestedScrollEnabled
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={true}
                    >
                      {eventMembers.map((item) => (
                        <Pressable
                          key={item.user_id}
                          style={[s.memberRow, assignAttendeeId === item.user_id && s.memberRowSelected]}
                          onPress={() => { setAssignAttendeeId(item.user_id); setAttendeeDropdownOpen(false); }}
                        >
                          <Text style={s.memberName}>{item.full_name}</Text>
                        </Pressable>
                      ))}
                      {eventMembers.length === 0 && <Text style={s.noSlots}>No event members to assign.</Text>}
                    </ScrollView>
                  )}
                </View>

                <View style={s.modalSection}>
                  <Text style={s.modalSectionLabel}>2. Date & time</Text>
                  <TouchableOpacity style={s.dateTimeTrigger} onPress={() => setShowDatePicker(true)}>
                    <Calendar size={20} color={colors.primary} />
                    <Text style={s.dateTimeText}>{format(assignDateTime, 'EEEE, MMM d, yyyy')}</Text>
                  </TouchableOpacity>
                {showDatePicker && (
                  <>
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity onPress={() => setShowDatePicker(false)} style={s.pickerDone}>
                        <Text style={s.pickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    )}
                    <DateTimePicker
                      value={assignDateTime}
                      mode="date"
                      // iOS: use the native default picker (calendar-style on iOS) without breaking modal.
                      display={Platform.OS === 'ios' ? 'default' : 'default'}
                      minimumDate={new Date()}
                      onChange={(_, date) => {
                        if (Platform.OS === 'android') setShowDatePicker(false);
                        if (date) {
                          setAssignDateTime((prev) => {
                            const d = new Date(prev);
                            d.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                            return d;
                          });
                          setAssignEndDateTime((prev) => {
                            const d = new Date(prev);
                            d.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                            return d;
                          });
                        }
                      }}
                      {...(Platform.OS === 'ios' && { themeVariant: 'light' as const, accentColor: colors.primary })}
                    />
                  </>
                )}
                  <View style={s.timeRow}>
                    <TouchableOpacity style={s.timeTrigger} onPress={() => setShowTimePicker(true)}>
                      <Clock size={18} color={colors.primary} />
                      <Text style={s.timeTriggerLabel}>Start</Text>
                      <Text style={s.dateTimeText}>{format(assignDateTime, 'h:mm a')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.timeTrigger} onPress={() => setShowEndTimePicker(true)}>
                      <Clock size={18} color={colors.primary} />
                      <Text style={s.timeTriggerLabel}>End</Text>
                      <Text style={s.dateTimeText}>{format(assignEndDateTime, 'h:mm a')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {showTimePicker && (
                  <>
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity onPress={() => setShowTimePicker(false)} style={s.pickerDone}>
                        <Text style={s.pickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    )}
                    <DateTimePicker
                      value={assignDateTime}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'default' : 'default'}
                      onChange={(_, date) => {
                        if (Platform.OS === 'android') setShowTimePicker(false);
                        if (date) {
                          const start = new Date(assignDateTime);
                          start.setHours(date.getHours(), date.getMinutes(), 0, 0);
                          setAssignDateTime(start);
                          const end = new Date(start.getTime() + 30 * 60 * 1000);
                          setAssignEndDateTime(end);
                        }
                      }}
                      {...(Platform.OS === 'ios' && { themeVariant: 'light' as const, accentColor: colors.primary })}
                    />
                  </>
                )}
                {showEndTimePicker && (
                  <>
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity onPress={() => setShowEndTimePicker(false)} style={s.pickerDone}>
                        <Text style={s.pickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    )}
                    <DateTimePicker
                      value={assignEndDateTime}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'default' : 'default'}
                      onChange={(_, date) => {
                        if (Platform.OS === 'android') setShowEndTimePicker(false);
                        if (date) setAssignEndDateTime((prev) => { const d = new Date(prev); d.setHours(date.getHours(), date.getMinutes(), 0, 0); return d; });
                      }}
                      {...(Platform.OS === 'ios' && { themeVariant: 'light' as const, accentColor: colors.primary })}
                    />
                  </>
                )}
              </ScrollView>
              <View style={s.modalActions}>
                <TouchableOpacity style={s.modalCancelBtn} onPress={() => setAssignModalVisible(false)} disabled={assigning}>
                  <Text style={s.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalAssignBtn, (!assignAttendeeId || assigning || assignEndDateTime.getTime() <= assignDateTime.getTime()) && s.modalAssignBtnDisabled]}
                  onPress={assignMeeting}
                  disabled={!assignAttendeeId || assigning || assignEndDateTime.getTime() <= assignDateTime.getTime()}
                >
                  {assigning ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.modalAssignBtnText}>Assign</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {isAdmin && editSlot && editBooking && (
        <Modal visible={editModalVisible} animationType="slide" transparent>
          <Pressable style={s.modalOverlay} onPress={() => !editing && setEditModalVisible(false)}>
            <Pressable style={s.modalContent} onPress={(e) => e.stopPropagation()}>
              <ScrollView
                style={s.modalScroll}
                contentContainerStyle={s.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                <Text style={s.modalTitle}>Edit meeting</Text>
                <Text style={s.modalSub}>Change date/time or attendee.</Text>
                <Text style={s.modalLabel}>Attendee</Text>
                <TouchableOpacity
                  style={s.dropdownTrigger}
                  onPress={() => setEditAttendeeDropdownOpen(!editAttendeeDropdownOpen)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.dropdownTriggerText, !editAttendeeId && s.dropdownPlaceholder]}>
                    {editAttendeeId ? (eventMembers.find((m) => m.user_id === editAttendeeId)?.full_name ?? 'Unknown') : 'Select attendee'}
                  </Text>
                  <ChevronDown size={20} color={colors.textMuted} style={{ transform: [{ rotate: editAttendeeDropdownOpen ? '180deg' : '0deg' }] }} />
                </TouchableOpacity>
                {editAttendeeDropdownOpen && (
                  <ScrollView
                    style={s.memberListWrap}
                    contentContainerStyle={s.memberListContent}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={true}
                  >
                    {eventMembers.map((item) => (
                      <Pressable
                        key={item.user_id}
                        style={[s.memberRow, editAttendeeId === item.user_id && s.memberRowSelected]}
                        onPress={() => { setEditAttendeeId(item.user_id); setEditAttendeeDropdownOpen(false); }}
                      >
                        <Text style={s.memberName}>{item.full_name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
                <Text style={s.modalLabel}>Start</Text>
                <TouchableOpacity style={s.dateTimeTrigger} onPress={() => setEditShowDatePicker(true)}>
                  <Calendar size={20} color={colors.primary} />
                  <Text style={s.dateTimeText}>{format(editDateTime, 'MMM d, yyyy')}</Text>
                </TouchableOpacity>
                {editShowDatePicker && (
                  <>
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity onPress={() => setEditShowDatePicker(false)} style={s.pickerDone}>
                        <Text style={s.pickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    )}
                    <DateTimePicker
                      value={editDateTime}
                      mode="date"
                      // iOS: use the native default picker (calendar-style on iOS) without breaking modal.
                      display={Platform.OS === 'ios' ? 'default' : 'default'}
                      onChange={(_, date) => {
                        if (Platform.OS === 'android') setEditShowDatePicker(false);
                        if (date) setEditDateTime((prev) => { const d = new Date(prev); d.setFullYear(date.getFullYear(), date.getMonth(), date.getDate()); return d; });
                      }}
                      {...(Platform.OS === 'ios' && { themeVariant: 'light' as const, accentColor: colors.primary })}
                    />
                  </>
                )}
                <TouchableOpacity style={s.dateTimeTrigger} onPress={() => setEditShowTimePicker(true)}>
                  <Clock size={20} color={colors.primary} />
                  <Text style={s.dateTimeText}>{format(editDateTime, 'h:mm a')}</Text>
                </TouchableOpacity>
                {editShowTimePicker && (
                  <>
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity onPress={() => setEditShowTimePicker(false)} style={s.pickerDone}>
                        <Text style={s.pickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    )}
                    <DateTimePicker
                      value={editDateTime}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'default' : 'default'}
                      onChange={(_, date) => {
                        if (Platform.OS === 'android') setEditShowTimePicker(false);
                        if (date) setEditDateTime((prev) => { const d = new Date(prev); d.setHours(date.getHours(), date.getMinutes(), 0, 0); return d; });
                      }}
                      {...(Platform.OS === 'ios' && { themeVariant: 'light' as const, accentColor: colors.primary })}
                    />
                  </>
                )}

                <Text style={s.modalLabel}>End</Text>
                <TouchableOpacity style={s.dateTimeTrigger} onPress={() => setEditShowEndDatePicker(true)}>
                  <Calendar size={20} color={colors.primary} />
                  <Text style={s.dateTimeText}>{format(editEndDateTime, 'MMM d, yyyy')}</Text>
                </TouchableOpacity>
                {editShowEndDatePicker && (
                  <>
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity onPress={() => setEditShowEndDatePicker(false)} style={s.pickerDone}>
                        <Text style={s.pickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    )}
                    <DateTimePicker
                      value={editEndDateTime}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'default' : 'default'}
                      onChange={(_, date) => {
                        if (Platform.OS === 'android') setEditShowEndDatePicker(false);
                        if (date) setEditEndDateTime((prev) => { const d = new Date(prev); d.setFullYear(date.getFullYear(), date.getMonth(), date.getDate()); return d; });
                      }}
                      {...(Platform.OS === 'ios' && { themeVariant: 'light' as const, accentColor: colors.primary })}
                    />
                  </>
                )}
                <TouchableOpacity style={s.dateTimeTrigger} onPress={() => setEditShowEndTimePicker(true)}>
                  <Clock size={20} color={colors.primary} />
                  <Text style={s.dateTimeText}>{format(editEndDateTime, 'h:mm a')}</Text>
                </TouchableOpacity>
                {editShowEndTimePicker && (
                  <>
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity onPress={() => setEditShowEndTimePicker(false)} style={s.pickerDone}>
                        <Text style={s.pickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    )}
                    <DateTimePicker
                      value={editEndDateTime}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'default' : 'default'}
                      onChange={(_, date) => {
                        if (Platform.OS === 'android') setEditShowEndTimePicker(false);
                        if (date) setEditEndDateTime((prev) => { const d = new Date(prev); d.setHours(date.getHours(), date.getMinutes(), 0, 0); return d; });
                      }}
                      {...(Platform.OS === 'ios' && { themeVariant: 'light' as const, accentColor: colors.primary })}
                    />
                  </>
                )}
              </ScrollView>
              <View style={s.modalActions}>
                <TouchableOpacity style={s.modalCancelBtn} onPress={() => setEditModalVisible(false)} disabled={editing}>
                  <Text style={s.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalAssignBtn, (!editAttendeeId || editing) && s.modalAssignBtnDisabled]}
                  onPress={saveEditMeeting}
                  disabled={!editAttendeeId || editing || editEndDateTime.getTime() <= editDateTime.getTime()}
                >
                  {editing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.modalAssignBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Rate B2B meeting modal (attendee only; vendors cannot rate) */}
      <Modal visible={!!rateModalBooking && !canViewAllMeetings} animationType="slide" transparent onRequestClose={closeRateModal}>
        <View style={s.modalOverlay}>
          <Pressable style={s.modalBackdrop} onPress={closeRateModal} />
          <Pressable style={[s.modalContent, { maxHeight: rateModalMaxH }]} onPress={(e) => e.stopPropagation()}>
            <ScrollView
              style={[s.modalScroll, { maxHeight: rateModalMaxH - 40 }]}
              contentContainerStyle={s.rateModalScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              nestedScrollEnabled
              showsVerticalScrollIndicator
              bounces={Platform.OS === 'ios'}
            >
              <Text style={s.modalTitle}>Rate your meeting</Text>
              <Text style={s.modalSub}>How was your meeting with {booth?.vendor_name}?</Text>

              <View style={s.modalSection}>
                <Text style={s.modalSectionLabel}>Rating (1–5)</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <TouchableOpacity key={n} onPress={() => setFeedbackRating(n)} style={{ padding: 4 }}>
                      <Star size={32} color={feedbackRating >= n ? colors.primary : colors.textMuted} fill={feedbackRating >= n ? colors.primary : 'transparent'} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={s.modalSection}>
                <Text style={s.modalSectionLabel}>Optional comment</Text>
                <TextInput
                  style={[s.modalInput, { minHeight: 88, textAlignVertical: 'top' }]}
                  placeholder="Share your experience..."
                  placeholderTextColor={colors.textMuted}
                  value={feedbackComment}
                  onChangeText={setFeedbackComment}
                  multiline
                  scrollEnabled={false}
                  maxLength={500}
                />
              </View>

              <View style={s.modalSection}>
                <Text style={s.modalSectionLabel}>Would you meet with this vendor again?</Text>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                  <TouchableOpacity
                    style={[s.feedbackToggle, feedbackMeetAgain === true && s.feedbackToggleYes]}
                    onPress={() => setFeedbackMeetAgain(true)}
                  >
                    <Text style={[s.feedbackToggleText, feedbackMeetAgain === true && { color: '#fff' }]}>Yes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.feedbackToggle, feedbackMeetAgain === false && s.feedbackToggleNo]}
                    onPress={() => setFeedbackMeetAgain(false)}
                  >
                    <Text style={[s.feedbackToggleText, feedbackMeetAgain === false && { color: '#fff' }]}>No</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.modalSection}>
                <Text style={s.modalSectionLabel}>Would you recommend this vendor?</Text>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                  <TouchableOpacity
                    style={[s.feedbackToggle, feedbackRecommend === true && s.feedbackToggleYes]}
                    onPress={() => setFeedbackRecommend(true)}
                  >
                    <Text style={[s.feedbackToggleText, feedbackRecommend === true && { color: '#fff' }]}>Yes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.feedbackToggle, feedbackRecommend === false && s.feedbackToggleNo]}
                    onPress={() => setFeedbackRecommend(false)}
                  >
                    <Text style={[s.feedbackToggleText, feedbackRecommend === false && { color: '#fff' }]}>No</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.modalSection}>
                <Text style={s.modalSectionLabel}>How likely are you to work with this vendor in future? (1–5)</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <TouchableOpacity
                      key={n}
                      style={[s.workWithChip, feedbackWorkWith === n && s.workWithChipSelected]}
                      onPress={() => setFeedbackWorkWith(n)}
                    >
                      <Text style={[s.workWithChipText, feedbackWorkWith === n && s.workWithChipTextSelected]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={s.modalActions}>
                <TouchableOpacity style={s.modalCancelBtn} onPress={closeRateModal} disabled={savingFeedback}>
                  <Text style={s.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalAssignBtn, (feedbackMeetAgain === null || feedbackRecommend === null || feedbackRating < 1 || feedbackWorkWith < 1 || savingFeedback) && s.modalAssignBtnDisabled]}
                  disabled={feedbackMeetAgain === null || feedbackRecommend === null || feedbackRating < 1 || feedbackWorkWith < 1 || savingFeedback}
                  onPress={async () => {
                    if (!rateModalBooking || !user?.id || feedbackMeetAgain === null || feedbackRecommend === null || feedbackRating < 1 || feedbackWorkWith < 1) return;
                    setSavingFeedback(true);
                    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
                    try {
                      const { error } = await client.from('b2b_meeting_feedback').upsert(
                        {
                          booking_id: rateModalBooking.id,
                          user_id: user.id,
                          rating: feedbackRating,
                          comment: feedbackComment.trim() || null,
                          meet_again: feedbackMeetAgain,
                          recommend_vendor: feedbackRecommend,
                          work_with_likelihood: feedbackWorkWith,
                        },
                        { onConflict: 'booking_id,user_id' }
                      );
                      if (error) throw error;
                      if (currentEvent?.id) {
                        awardPoints(user.id, currentEvent.id, 'b2b_feedback', rateModalBooking.id).catch(() => {});
                      }
                      closeRateModal();
                      setFeedbackBookingIds((prev) => new Set(prev).add(rateModalBooking.id));
                      fetchBoothAndSlots();
                    } catch (e) {
                      console.error('Save B2B feedback error:', e);
                      Alert.alert('Error', 'Could not save feedback. Try again.');
                    } finally {
                      setSavingFeedback(false);
                    }
                  }}
                >
                  {savingFeedback ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.modalAssignBtnText}>Submit</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Pressable>
        </View>
      </Modal>

      {/* Admin/vendor: attendee pre-meeting brief + "have we met before" history */}
      <VendorAttendeeBriefModal
        visible={briefModalVisible}
        onClose={closeBriefModal}
        eventId={currentEvent?.id}
        subjectUserId={briefSubjectId}
        subjectName={briefName}
        meetings={briefMeetings}
        showPriorInteractions={vendorBriefEnabled}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerBack: { padding: 8, marginRight: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 16, color: colors.textSecondary },
  backBtn: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 20, backgroundColor: colors.primary, borderRadius: 10 },
  backBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  heroSection: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  boothHeroLogo: { width: 112, height: 112, borderRadius: 20, backgroundColor: colors.card },
  boothHeroLogoPlaceholder: {
    width: 112,
    height: 112,
    borderRadius: 20,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  boothDetailVendorNameHero: { marginTop: 16, fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: 0.3, textAlign: 'center' },
  detailCard: {
    backgroundColor: colors.card,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
  },
  detailSectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  boothDetailDescription: { fontSize: 15, color: colors.textSecondary, lineHeight: 22 },
  repRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 },
  repRowName: { fontSize: 15, fontWeight: '700', color: colors.text },
  repRowSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 },
  detailMetaText: { fontSize: 15, color: colors.text },
  yourMeetingCard: {
    marginHorizontal: 16,
    marginBottom: 24,
    padding: 20,
    borderRadius: 16,
    backgroundColor: colors.primaryFaded,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  yourMeetingTitle: { fontSize: 13, fontWeight: '700', color: colors.primary, letterSpacing: 0.5, marginBottom: 12 },
  yourMeetingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  yourMeetingTime: { fontSize: 16, fontWeight: '600', color: colors.text },
  yourMeetingLocation: { fontSize: 15, color: colors.textSecondary },
  yourMeetingStatus: { fontSize: 13, fontWeight: '600', color: colors.primary, marginTop: 4 },
  ratedMeetingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  ratedMeetingText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  sectionContent: { paddingHorizontal: 16 },
  logo: { width: 80, height: 80, borderRadius: 12, marginTop: 12, marginBottom: 12 },
  logoPlaceholder: { width: 80, height: 80, borderRadius: 12, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  vendorName: { fontSize: 20, fontWeight: '700', color: colors.text },
  description: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', marginTop: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  metaText: { fontSize: 14, color: colors.textMuted },
  websiteBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 },
  websiteText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12 },
  subsectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 8, marginTop: 4 },
  subsectionTitleCancelled: { marginTop: 16, color: colors.textMuted },
  noSlots: { fontSize: 15, color: colors.textMuted },
  slotCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  slotCardPast: { opacity: 0.85 },
  slotCardCancelled: { opacity: 0.88, backgroundColor: colors.surface },
  slotTimeMuted: { color: colors.textMuted },
  cancelledBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  bookingTextMuted: { color: colors.textMuted },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slotTime: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  slotLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  slotLocationText: { fontSize: 13, color: colors.textMuted },
  pastBadge: { fontSize: 11, fontWeight: '600', color: colors.textMuted, backgroundColor: colors.surface, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  upcomingBadge: { fontSize: 11, fontWeight: '600', color: colors.primary, backgroundColor: colors.primaryFaded, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  liveBadge: { fontSize: 11, fontWeight: '600', color: '#fff', backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 14, color: colors.textSecondary, marginTop: 8 },
  adminActionsRow: { gap: 10, marginBottom: 16 },
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
  },
  assignBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  cancelAllBtn: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.danger },
  cancelAllBtnText: { fontSize: 16, fontWeight: '600', color: colors.danger },
  deleteSlotBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger,
    alignSelf: 'flex-start',
  },
  deleteSlotBtnText: { fontSize: 14, fontWeight: '600', color: colors.danger },
  bookingsList: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  bookingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  bookingRowLeft: { flex: 1, gap: 8 },
  bookingNameCol: { flex: 1, gap: 4 },
  bookingNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  bookingAttendee: { fontSize: 14, fontWeight: '600', color: colors.text },
  viewBriefHint: { fontSize: 12, fontWeight: '600', color: colors.primary },
  bookingStatus: { fontSize: 13, color: colors.textMuted },
  metBeforeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryFaded,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    maxWidth: '100%',
  },
  metBeforeChipText: { fontSize: 11, fontWeight: '700', color: colors.primary, flexShrink: 1 },
  briefHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  briefCloseBtn: { padding: 2 },
  briefLoadingBox: { paddingVertical: 40, alignItems: 'center' },
  briefErrorText: { fontSize: 15, color: colors.danger, paddingVertical: 20 },
  briefSubtitle: { fontSize: 15, color: colors.textSecondary, marginBottom: 12 },
  briefSection: { marginTop: 8, marginBottom: 12 },
  briefSectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.4 },
  briefBio: { fontSize: 15, color: colors.text, lineHeight: 22, marginTop: 6 },
  briefLinkedinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.primaryFaded,
    marginBottom: 4,
  },
  briefLinkedinText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  briefMetHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  briefEmptyText: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic' },
  briefHistoryGroup: { marginTop: 8 },
  briefHistorySubLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
  briefHistoryCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  briefHistoryEvent: { fontSize: 14, fontWeight: '700', color: colors.text },
  briefHistoryMeta: { fontSize: 13, color: colors.textMuted, marginTop: 3 },
  briefNoteText: { fontSize: 14, color: colors.text, fontStyle: 'italic', marginTop: 4, lineHeight: 20 },
  bookingActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bookingActionBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  bookingActionEdit: { fontSize: 14, fontWeight: '600', color: colors.primary },
  bookingActionCancel: { fontSize: 14, fontWeight: '600', color: colors.danger },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContent: { backgroundColor: colors.card, borderRadius: 16, padding: 20, maxHeight: '85%' },
  modalScroll: { flexGrow: 0, maxHeight: '100%' },
  modalScrollContent: { paddingBottom: 12 },
  /** Rate-meeting modal: extra bottom padding so last controls stay above thumb / keyboard. */
  rateModalScrollContent: { paddingBottom: 28, flexGrow: 0 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 6 },
  modalSub: { fontSize: 14, color: colors.textSecondary, marginBottom: 20 },
  modalSection: { marginBottom: 20 },
  modalSectionLabel: { fontSize: 12, fontWeight: '700', color: colors.primary, letterSpacing: 0.4, marginBottom: 10 },
  modalLabel: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 8, marginBottom: 4 },
  timeRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  timeTrigger: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14 },
  timeTriggerLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 4 },
  modalSlotList: { maxHeight: 120, marginBottom: 8 },
  dropdownTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8, backgroundColor: colors.surface },
  dropdownTriggerText: { fontSize: 16, color: colors.text },
  dropdownPlaceholder: { color: colors.textMuted },
  memberListWrap: { maxHeight: 220, marginBottom: 4 },
  memberListContent: { paddingBottom: 8 },
  memberList: { maxHeight: 180 },
  memberRow: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.surface, marginBottom: 6 },
  memberRowSelected: { backgroundColor: colors.primaryFaded, borderWidth: 1, borderColor: colors.primary },
  memberName: { fontSize: 15, color: colors.text },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  modalCancelBtnText: { fontSize: 16, color: colors.textSecondary },
  modalAssignBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, minHeight: 44 },
  modalAssignBtnDisabled: { opacity: 0.6 },
  modalAssignBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  dateTimeTrigger: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, marginTop: 8, backgroundColor: colors.surface },
  dateTimeText: { fontSize: 16, color: colors.text },
  pickerDone: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4 },
  pickerDoneText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  newTimeToggle: { paddingVertical: 12, marginTop: 8 },
  newTimeToggleText: { fontSize: 15, color: colors.primary, fontWeight: '600' },
  newTimeRow: { marginTop: 8 },
  newTimeLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  modalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.text },
  rateMeetingBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.primaryFaded, borderRadius: 10, alignSelf: 'flex-start' },
  rateMeetingBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  feedbackToggle: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  feedbackToggleYes: { backgroundColor: colors.primary, borderColor: colors.primary },
  feedbackToggleNo: { backgroundColor: colors.danger, borderColor: colors.danger },
  feedbackToggleText: { fontSize: 15, fontWeight: '600', color: colors.text },
  workWithChip: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  workWithChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  workWithChipText: { fontSize: 16, fontWeight: '600', color: colors.text },
  workWithChipTextSelected: { color: '#fff' },
});
