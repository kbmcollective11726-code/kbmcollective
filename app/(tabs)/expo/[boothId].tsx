import { useEffect, useState, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Store, MapPin, ExternalLink, ChevronLeft, Calendar, UserPlus, ChevronDown, Clock, Star } from 'lucide-react-native';
import { format, parseISO, isPast } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, supabaseStorage } from '../../../lib/supabase';
import { awardPoints } from '../../../lib/points';
import { createNotificationAndPush } from '../../../lib/notifications';
import { colors } from '../../../constants/colors';
import type { VendorBooth, MeetingSlot, MeetingBooking, MeetingBookingStatus } from '../../../lib/types';

type SlotWithBooking = MeetingSlot & {
  myBooking?: MeetingBooking | null;
  bookings?: (MeetingBooking & { attendee_name?: string })[];
};

export default function BoothDetailScreen() {
  const params = useLocalSearchParams<{ boothId: string; from?: string }>();
  const boothId = typeof params.boothId === 'string' ? params.boothId : Array.isArray(params.boothId) ? params.boothId[0] : undefined;
  const from = typeof params.from === 'string' ? params.from : Array.isArray(params.from) ? params.from[0] : undefined;
  const router = useRouter();

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
  const [booth, setBooth] = useState<VendorBooth | null>(null);
  const [slots, setSlots] = useState<SlotWithBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bookingActionId, setBookingActionId] = useState<string | null>(null);
  const [isVendorOrAdmin, setIsVendorOrAdmin] = useState(false);
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
  const [editAttendeeId, setEditAttendeeId] = useState<string | null>(null);
  const [editAttendeeDropdownOpen, setEditAttendeeDropdownOpen] = useState(false);
  const [editShowDatePicker, setEditShowDatePicker] = useState(false);
  const [editShowTimePicker, setEditShowTimePicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelAlling, setCancelAlling] = useState(false);
  const [feedbackBookingIds, setFeedbackBookingIds] = useState<Set<string>>(new Set());
  const [rateModalBooking, setRateModalBooking] = useState<MeetingBooking | null>(null);
  const [rateModalSlot, setRateModalSlot] = useState<SlotWithBooking | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<number>(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackMeetAgain, setFeedbackMeetAgain] = useState<boolean | null>(null);
  const [feedbackRecommend, setFeedbackRecommend] = useState<boolean | null>(null);
  const [feedbackWorkWith, setFeedbackWorkWith] = useState<number>(5);
  const [savingFeedback, setSavingFeedback] = useState(false);

  const fetchBoothAndSlots = useCallback(async () => {
    if (!boothId || !currentEvent?.id) {
      setBooth(null);
      setSlots([]);
      setLoading(false);
      return;
    }
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      const [boothRes, slotsRes, roleRes, bookingsRes, myRepBoothsRes] = await Promise.all([
        client.from('vendor_booths').select('*').eq('id', boothId).eq('is_active', true).maybeSingle(),
        client.from('meeting_slots').select('id, booth_id, start_time, end_time, is_available, created_at').eq('booth_id', boothId).order('start_time', { ascending: true }),
        user?.id ? client.from('event_members').select('role, roles').eq('event_id', currentEvent.id).eq('user_id', user.id).single() : Promise.resolve({ data: null }),
        user?.id ? client.from('meeting_bookings').select('id, slot_id, attendee_id, status, notes, created_at').eq('attendee_id', user.id) : Promise.resolve({ data: [] }),
        user?.id ? client.from('vendor_booths').select('id').eq('event_id', currentEvent.id).eq('is_active', true).eq('contact_user_id', user.id) : Promise.resolve({ data: [] }),
      ]);

      if (boothRes.error || !boothRes.data) {
        setBooth(null);
        setSlots([]);
        setLoading(false);
        return;
      }
      const boothData = boothRes.data as VendorBooth & { contact_user_id?: string | null };
      const myRepBoothIds = (myRepBoothsRes.data ?? []).map((b: { id: string }) => b.id);
      const isVendorRepOfSomeBooth = myRepBoothIds.length > 0;
      const isVendorRepOfThisBooth = boothData?.contact_user_id === user?.id;
      if (isVendorRepOfSomeBooth && !isVendorRepOfThisBooth) {
        setBooth(null);
        setSlots([]);
        setLoading(false);
        router.replace('/(tabs)/expo' as any);
        return;
      }
      setBooth(boothData);

      const roleRow = roleRes.data as { role?: string; roles?: string[] } | null;
      const roles = Array.isArray(roleRow?.roles) ? roleRow.roles : [];
      const role = roleRow?.role ?? roles[0];
      const isVendorByRole =
        user?.is_platform_admin === true ||
        role === 'admin' ||
        role === 'super_admin' ||
        role === 'vendor' ||
        roles.includes('admin') ||
        roles.includes('super_admin') ||
        roles.includes('vendor');
      const isVendorRep = boothData?.contact_user_id === user?.id;
      const isVendor = isVendorByRole || isVendorRep;
      const isEventAdmin =
        user?.is_platform_admin === true ||
        role === 'admin' ||
        role === 'super_admin' ||
        roles.includes('admin') ||
        roles.includes('super_admin');
      setIsVendorOrAdmin(isVendor);
      setIsAdmin(isEventAdmin);

      const slotsData = (slotsRes.data ?? []) as MeetingSlot[];
      const myBookings = (bookingsRes.data ?? []) as MeetingBooking[];
      const myBySlot = new Map(myBookings.map((b) => [b.slot_id, b]));

      if (user?.id && myBookings.length > 0) {
        const bookingIds = myBookings.map((b) => b.id);
        const { data: feedbackRows } = await client
          .from('b2b_meeting_feedback')
          .select('booking_id')
          .eq('user_id', user.id)
          .in('booking_id', bookingIds);
        setFeedbackBookingIds(new Set((feedbackRows ?? []).map((r: { booking_id: string }) => r.booking_id)));
      } else {
        setFeedbackBookingIds(new Set());
      }

      if (isVendor && slotsData.length > 0) {
        const slotIds = slotsData.map((s) => s.id);
        const { data: allBookings } = await client.from('meeting_bookings').select('id, slot_id, attendee_id, status, notes, created_at').in('slot_id', slotIds);
        const bookingsList = (allBookings ?? []) as MeetingBooking[];
        const attendeeIds = [...new Set(bookingsList.map((b) => b.attendee_id))];
        const { data: usersData } = attendeeIds.length > 0 ? await client.from('users').select('id, full_name').in('id', attendeeIds) : { data: [] };
        const nameByUserId = new Map((usersData ?? []).map((u: { id: string; full_name: string }) => [u.id, u.full_name ?? '']));
        const bySlot = new Map<string, (MeetingBooking & { attendee_name?: string })[]>();
        for (const b of bookingsList) {
          if (b.status === 'cancelled') continue;
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
      } else {
        setSlots(
          slotsData.map((slot) => ({
            ...slot,
            myBooking: myBySlot.get(slot.id) ?? null,
            bookings: [],
          }))
        );
      }
    } catch (e) {
      console.error('Booth detail fetch error:', e);
      setBooth(null);
      setSlots([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [boothId, currentEvent?.id, user?.id]);

  useEffect(() => {
    if (boothId === undefined || boothId === '' || (typeof boothId === 'string' && boothId.startsWith('['))) {
      router.replace('/(tabs)/expo' as any);
    }
  }, [boothId, router]);

  useFocusEffect(
    useCallback(() => {
      if (boothId && currentEvent?.id) {
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
    if (!boothId || !isVendorOrAdmin) return;
    let cancelled = false;
    const refetch = () => { if (!cancelled) fetchBoothAndSlots(); };
    const t = setInterval(refetch, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [boothId, isVendorOrAdmin, fetchBoothAndSlots]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchBoothAndSlots();
  };

  const ASSIGN_TIMEOUT_MS = 20_000;
  const withAssignTimeout = <T,>(p: Promise<T>, label: string): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out. Check your connection.`)), ASSIGN_TIMEOUT_MS))]);

  const assignMeeting = async () => {
    if (!isAdmin || !assignAttendeeId || !currentEvent?.id || !boothId) return;
    const start = new Date(assignDateTime);
    const end = new Date(assignEndDateTime);
    if (end.getTime() <= start.getTime()) {
      Alert.alert('Invalid time', 'End time must be after start time.');
      return;
    }
    setAssigning(true);
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      const { data: newSlot, error: slotErr } = await withAssignTimeout(
        Promise.resolve(client.from('meeting_slots').insert({ booth_id: boothId, start_time: start.toISOString(), end_time: end.toISOString(), is_available: true }).select('id').single()),
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
      await createNotificationAndPush(
        assignAttendeeId,
        currentEvent?.id ?? null,
        'meeting',
        'Meeting assigned',
        `You have a meeting with ${vendorName} on ${format(assignDateTime, 'EEE, MMM d')} at ${format(assignDateTime, 'h:mm a')}.`,
        { booth_id: boothId }
      );
    } catch (e: unknown) {
      console.error('Assign meeting error:', e);
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Could not assign meeting.';
      Alert.alert('Error', msg.includes('row-level security') || msg.includes('policy') ? 'Permission denied. Run the "Admins can assign meeting bookings" migration in Supabase (see RUN-THESE-MIGRATIONS.sql).' : msg);
    } finally {
      setAssigning(false);
    }
  };

  const formatSlotTime = (start: string, end: string) => {
    try {
      const s = parseISO(start.replace(' ', 'T'));
      const e = parseISO(end.replace(' ', 'T'));
      return `${format(s, 'EEE, MMM d · h:mm a')} – ${format(e, 'h:mm a')}`;
    } catch {
      return `${start} – ${end}`;
    }
  };

  const slotsToShow = isVendorOrAdmin ? slots : slots.filter((s) => s.myBooking && s.myBooking.status !== 'cancelled');

  const slotInPast = (startTime: string) => {
    try {
      const d = parseISO(startTime.replace(' ', 'T'));
      return isPast(d);
    } catch {
      return false;
    }
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
            if (attendeeId && currentEvent?.id) {
              await createNotificationAndPush(
                attendeeId,
                currentEvent.id,
                'meeting',
                'Meeting cancelled',
                `Your meeting with ${vendorName} has been cancelled.`,
                { booth_id: boothId }
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
                  await createNotificationAndPush(
                    uid,
                    currentEvent.id,
                    'meeting',
                    'Meeting cancelled',
                    `Your meeting with ${vendorName} has been cancelled.`,
                    { booth_id: boothId }
                  );
                }
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
      const start = parseISO(slot.start_time.replace(' ', 'T'));
      setEditSlot(slot);
      setEditBooking(booking);
      setEditDateTime(start);
      setEditAttendeeId(booking.attendee_id);
      setEditAttendeeDropdownOpen(false);
      setEditShowDatePicker(false);
      setEditShowTimePicker(false);
      setEditModalVisible(true);
    } catch {
      Alert.alert('Error', 'Could not open edit.');
    }
  };

  const saveEditMeeting = async () => {
    if (!editSlot || !editBooking || !editAttendeeId) return;
    const start = new Date(editDateTime);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    setEditing(true);
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      const { error: slotErr } = await withAssignTimeout(
        Promise.resolve(client.from('meeting_slots').update({ start_time: start.toISOString(), end_time: end.toISOString() }).eq('id', editSlot.id)),
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
      setEditSlot(null);
      setEditBooking(null);
      await fetchBoothAndSlots();
      if (currentEvent?.id && boothId) {
        await createNotificationAndPush(
          editAttendeeId,
          currentEvent.id,
          'meeting',
          'Meeting updated',
          `Your meeting with ${vendorName} is now ${format(editDateTime, 'EEE, MMM d')} at ${format(editDateTime, 'h:mm a')}.`,
          { booth_id: boothId }
        );
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

  if (!boothId || boothId === '' || (typeof boothId === 'string' && boothId.startsWith('['))) {
    return null;
  }

  if (loading && !booth) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
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
      <SafeAreaView style={s.container} edges={['bottom']}>
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

  const hasMyMeeting = slots.some((s) => s.myBooking && s.myBooking.status !== 'cancelled');
  if (!isVendorOrAdmin && !hasMyMeeting) {
    router.replace('/(tabs)/expo' as any);
    return null;
  }

  const myMeetingSlot = !isVendorOrAdmin && slotsToShow.length > 0 ? slotsToShow[0] : null;

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
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
          {(booth as { banner_url?: string | null }).banner_url ? (
            <Image source={{ uri: (booth as { banner_url: string }).banner_url }} style={s.boothBanner} resizeMode="cover" />
          ) : (
            <View style={s.boothBannerPlaceholder}>
              <Store size={48} color={colors.textMuted} />
            </View>
          )}
          <View style={s.heroOverlay} />
          <View style={s.heroContent}>
            {booth.logo_url ? (
              <Image source={{ uri: booth.logo_url }} style={s.boothDetailLogo} />
            ) : (
              <View style={s.boothDetailLogoPlaceholder}>
                <Store size={36} color={colors.textMuted} />
              </View>
            )}
            <Text style={s.boothDetailVendorName}>{booth.vendor_name}</Text>
          </View>
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
          </View>
        ) : null}

        {(isVendorOrAdmin || !myMeetingSlot) ? (
        <View style={s.sectionContent}>
        <Text style={s.sectionTitle}>{isVendorOrAdmin ? 'Meetings' : 'Meeting details'}</Text>
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
              const upcoming = slotsToShow.filter((s) => !slotInPast(s.start_time));
              const past = slotsToShow.filter((s) => slotInPast(s.start_time));
              const statusLabel: Record<MeetingBookingStatus, string> = {
                requested: 'Requested',
                confirmed: 'Confirmed',
                declined: 'Declined',
                cancelled: 'Cancelled',
              };
              const renderSlot = (slot: typeof slotsToShow[0]) => {
                const isPast = slotInPast(slot.start_time);
                const myBooking = slot.myBooking;
                return (
                  <View key={slot.id} style={[s.slotCard, isPast && s.slotCardPast]}>
                    <View style={s.slotRow}>
                      <Calendar size={18} color={isPast ? colors.textMuted : colors.primary} />
                      <Text style={s.slotTime}>{formatSlotTime(slot.start_time, slot.end_time)}</Text>
                      {isPast ? <Text style={s.pastBadge}>Past</Text> : <Text style={s.upcomingBadge}>Upcoming</Text>}
                    </View>
                    {booth.booth_location ? (
                      <View style={s.slotLocationRow}>
                        <MapPin size={14} color={colors.textMuted} />
                        <Text style={s.slotLocationText}>{booth.booth_location}</Text>
                      </View>
                    ) : null}
                    {!isVendorOrAdmin && myBooking && myBooking.status !== 'cancelled' && (
                      <>
                        <Text style={s.statusText}>Your meeting: {statusLabel[myBooking.status]}</Text>
                        {isPast && !feedbackBookingIds.has(myBooking.id) && (
                          <TouchableOpacity
                            style={s.rateMeetingBtn}
                            onPress={() => {
                              setRateModalBooking(myBooking);
                              setRateModalSlot(slot);
                              setFeedbackRating(5);
                              setFeedbackComment('');
                              setFeedbackMeetAgain(null);
                              setFeedbackRecommend(null);
                              setFeedbackWorkWith(5);
                            }}
                          >
                            <Star size={18} color={colors.primary} />
                            <Text style={s.rateMeetingBtnText}>Rate this meeting</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    )}
                    {isVendorOrAdmin && (slot.bookings?.length ?? 0) > 0 && (
                      <View style={s.bookingsList}>
                        {(slot.bookings ?? []).map((b) => (
                          <View key={b.id} style={s.bookingRow}>
                            <View style={s.bookingRowLeft}>
                              <Text style={s.bookingAttendee}>{b.attendee_name ?? `Attendee #${b.attendee_id.slice(0, 8)}…`}</Text>
                              <Text style={s.bookingStatus}>{statusLabel[b.status]}</Text>
                            </View>
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
                        ))}
                      </View>
                    )}
                  </View>
                );
              };
              return (
                <>
                  {upcoming.length > 0 && (
                    <>
                      <Text style={s.subsectionTitle}>Upcoming</Text>
                      {upcoming.map(renderSlot)}
                    </>
                  )}
                  {past.length > 0 && (
                    <>
                      <Text style={s.subsectionTitle}>Past</Text>
                      {past.map(renderSlot)}
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
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
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
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
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
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
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
                <Text style={s.modalLabel}>Date & time</Text>
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
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      minimumDate={new Date()}
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
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(_, date) => {
                        if (Platform.OS === 'android') setEditShowTimePicker(false);
                        if (date) setEditDateTime((prev) => { const d = new Date(prev); d.setHours(date.getHours(), date.getMinutes(), 0, 0); return d; });
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
                  disabled={!editAttendeeId || editing}
                >
                  {editing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.modalAssignBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Rate B2B meeting modal (attendee only) */}
      <Modal visible={!!rateModalBooking} animationType="slide" transparent onRequestClose={() => setRateModalBooking(null)}>
        <Pressable style={s.modalOverlay} onPress={() => !savingFeedback && setRateModalBooking(null)}>
          <Pressable style={s.modalContent} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={s.modalScroll} contentContainerStyle={s.modalScrollContent} keyboardShouldPersistTaps="handled">
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
                  style={[s.modalInput, { minHeight: 80, textAlignVertical: 'top' }]}
                  placeholder="Share your experience..."
                  placeholderTextColor={colors.textMuted}
                  value={feedbackComment}
                  onChangeText={setFeedbackComment}
                  multiline
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
                <TouchableOpacity style={s.modalCancelBtn} onPress={() => setRateModalBooking(null)} disabled={savingFeedback}>
                  <Text style={s.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalAssignBtn, (feedbackMeetAgain === null || feedbackRecommend === null || savingFeedback) && s.modalAssignBtnDisabled]}
                  disabled={feedbackMeetAgain === null || feedbackRecommend === null || savingFeedback}
                  onPress={async () => {
                    if (!rateModalBooking || !user?.id || feedbackMeetAgain === null || feedbackRecommend === null) return;
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
                      setRateModalBooking(null);
                      setRateModalSlot(null);
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
        </Pressable>
      </Modal>
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
  heroSection: { marginBottom: 0, position: 'relative' },
  boothBanner: { width: '100%', height: 160 },
  boothBannerPlaceholder: { width: '100%', height: 160, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  heroOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 80, backgroundColor: 'transparent' },
  heroContent: { position: 'absolute', bottom: 16, left: 16, right: 16, flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  boothDetailLogo: { width: 64, height: 64, borderRadius: 14, backgroundColor: colors.card },
  boothDetailLogoPlaceholder: { width: 64, height: 64, borderRadius: 14, backgroundColor: colors.card, justifyContent: 'center', alignItems: 'center' },
  boothDetailVendorName: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: 0.3 },
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
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slotTime: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  slotLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  slotLocationText: { fontSize: 13, color: colors.textMuted },
  pastBadge: { fontSize: 11, fontWeight: '600', color: colors.textMuted, backgroundColor: colors.surface, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  upcomingBadge: { fontSize: 11, fontWeight: '600', color: colors.primary, backgroundColor: colors.primaryFaded, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
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
  bookingsList: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  bookingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  bookingRowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  bookingAttendee: { fontSize: 14, color: colors.text },
  bookingStatus: { fontSize: 13, color: colors.textMuted },
  bookingActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bookingActionBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  bookingActionEdit: { fontSize: 14, fontWeight: '600', color: colors.primary },
  bookingActionCancel: { fontSize: 14, fontWeight: '600', color: colors.danger },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: colors.card, borderRadius: 16, padding: 20, maxHeight: '85%' },
  modalScroll: { flexGrow: 0, maxHeight: '100%' },
  modalScrollContent: { paddingBottom: 12 },
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
