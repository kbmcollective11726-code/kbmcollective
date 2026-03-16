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
import { Store, MapPin, ChevronRight, Calendar, Users } from 'lucide-react-native';
import { format, parseISO } from 'date-fns';
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
  meetingTimes: { start: string; end: string }[];
};

export type BoothWithMeeting = VendorBooth & { meetingStart?: string; meetingEnd?: string };

function formatMeetingTime(start: string, end: string): string {
  try {
    const s = parseISO(start.replace(' ', 'T'));
    const e = parseISO(end.replace(' ', 'T'));
    return `${format(s, 'EEE, MMM d · h:mm a')} – ${format(e, 'h:mm a')}`;
  } catch {
    return `${start} – ${end}`;
  }
}

export default function ExpoScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [booths, setBooths] = useState<BoothWithMeeting[]>([]);
  const [repAttendees, setRepAttendees] = useState<RepMeetingAttendee[]>([]);
  const [isVendorRep, setIsVendorRep] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEventAdmin, setIsEventAdmin] = useState(false);

  const fetchBooths = useCallback(async () => {
    if (!currentEvent?.id) {
      setBooths([]);
      setLoading(false);
      setError(null);
      return;
    }
    setError(null);
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      let list: BoothWithMeeting[] = [];

      if (user?.id) {
        const [roleDataRes, repBoothsRes, myBookingsRes] = await Promise.all([
          client.from('event_members').select('role, roles').eq('event_id', currentEvent.id).eq('user_id', user.id).single(),
          client.from('vendor_booths').select('id').eq('event_id', currentEvent.id).eq('is_active', true).eq('contact_user_id', user.id),
          client
            .from('meeting_bookings')
            .select('slot_id, meeting_slots(booth_id, start_time, end_time)')
            .eq('attendee_id', user.id)
            .neq('status', 'cancelled'),
        ]);
        const row = roleDataRes.data as { role?: string; roles?: string[] } | null;
        const roles = Array.isArray(row?.roles) ? row.roles : [];
        const role = row?.role ?? roles[0] ?? '';
        const isAdminOrVendor =
          user?.is_platform_admin === true ||
          role === 'admin' ||
          role === 'super_admin' ||
          role === 'vendor' ||
          roles.includes('admin') ||
          roles.includes('super_admin') ||
          roles.includes('vendor');
        const repBoothIds = (repBoothsRes.data ?? []).map((b: { id: string }) => b.id);
        const isVendorRep = repBoothIds.length > 0;

        if (isVendorRep) {
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
            list = [];
          } else {
            const { data: bookingsData } = await client
              .from('meeting_bookings')
              .select('slot_id, attendee_id')
              .in('slot_id', slotIds)
              .neq('status', 'cancelled');
            type BookingRow = { slot_id: string; attendee_id: string };
            const bookings = (bookingsData ?? []) as BookingRow[];
            const attendeeToTimes = new Map<string, { start: string; end: string }[]>();
            for (const b of bookings) {
              const slot = slotMap.get(b.slot_id);
              if (!slot) continue;
              const arr = attendeeToTimes.get(b.attendee_id) ?? [];
              arr.push(slot);
              attendeeToTimes.set(b.attendee_id, arr);
            }
            const attendeeIds = [...attendeeToTimes.keys()];
            if (attendeeIds.length === 0) {
              setBooths([]);
              setRepAttendees([]);
              list = [];
            } else {
              const { data: usersData } = await client
                .from('users')
                .select('id, full_name, company, title, avatar_url')
                .in('id', attendeeIds);
              const attendees: RepMeetingAttendee[] = (usersData ?? []).map((u: { id: string; full_name: string | null; company: string | null; title: string | null; avatar_url: string | null }) => ({
                id: u.id,
                full_name: u.full_name ?? null,
                company: u.company ?? null,
                title: u.title ?? null,
                avatar_url: u.avatar_url ?? null,
                meetingTimes: attendeeToTimes.get(u.id) ?? [],
              }));
              attendees.sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''));
              setBooths([]);
              setRepAttendees(attendees);
            }
            list = [];
          }
        } else {
          setIsVendorRep(false);
          setRepAttendees([]);
        }
        if (!isVendorRep) {
        if (!isAdminOrVendor) {
          type BookingRow = { slot_id: string; meeting_slots: { booth_id: string; start_time: string; end_time: string } | null };
          const rows = (myBookingsRes.data ?? []) as unknown as BookingRow[];
          const boothIdToSlot = new Map<string, { start_time: string; end_time: string }>();
          for (const r of rows) {
            const slot = r.meeting_slots;
            if (slot?.booth_id && slot.start_time && slot.end_time && !boothIdToSlot.has(slot.booth_id)) {
              boothIdToSlot.set(slot.booth_id, { start_time: slot.start_time, end_time: slot.end_time });
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
          list = ((boothData ?? []) as VendorBooth[]).map((b) => {
            const slot = boothIdToSlot.get(b.id);
            return { ...b, meetingStart: slot?.start_time, meetingEnd: slot?.end_time };
          });
        } else {
          const { data: boothData, error: e } = await client
            .from('vendor_booths')
            .select('*')
            .eq('event_id', currentEvent.id)
            .eq('is_active', true)
            .order('vendor_name');
          if (e) throw e;
          list = (boothData ?? []) as BoothWithMeeting[];
        }
        }
      } else {
        setIsVendorRep(false);
        setRepAttendees([]);
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
      setIsVendorRep(false);
      setError(err instanceof Error ? err.message : 'Could not load booths.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentEvent?.id, user?.id]);

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

  useEffect(() => {
    if (!user?.id || !currentEvent?.id) return;
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    (async () => {
      const { data } = await client
        .from('event_members')
        .select('role, roles')
        .eq('event_id', currentEvent.id)
        .eq('user_id', user.id)
        .single();
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
      <SafeAreaView style={s.container} edges={['bottom']}>
        <View style={s.centered}>
          <Text style={s.emptyText}>Select an event to see vendor booths.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && booths.length === 0 && repAttendees.length === 0) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>{isVendorRep ? 'Loading…' : 'Loading booths…'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Vendor rep first screen: list of people who signed up to meet with them
  if (isVendorRep) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        {error ? (
          <View style={s.errorBanner}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}
        {repAttendees.length === 0 ? (
          <View style={s.centered}>
            <Users size={48} color={colors.textMuted} />
            <Text style={s.emptyText}>No one has booked a meeting with you yet.</Text>
            <Text style={s.emptySubtext}>Attendees who book a slot at your booth will appear here.</Text>
          </View>
        ) : (
          <FlatList
            data={repAttendees}
            keyExtractor={(item) => item.id}
            contentContainerStyle={s.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
            ListHeaderComponent={
              <View style={s.repHeader}>
                <Text style={s.repTitle}>People you're meeting with</Text>
                <Text style={s.repSubtitle}>{repAttendees.length} {repAttendees.length === 1 ? 'person' : 'people'} signed up</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.attendeeCard}
                activeOpacity={0.7}
                onPress={() => router.push(`/(tabs)/feed/user/${item.id}?from=${encodeURIComponent('/(tabs)/expo')}` as any)}
              >
                <Avatar uri={item.avatar_url} name={item.full_name} size={48} />
                <View style={s.attendeeBody}>
                  <Text style={s.attendeeName} numberOfLines={1}>{item.full_name || 'Unknown'}</Text>
                  {item.company ? <Text style={s.attendeeMeta} numberOfLines={1}>{item.company}</Text> : null}
                  {item.title ? <Text style={s.attendeeMeta} numberOfLines={1}>{item.title}</Text> : null}
                  {item.meetingTimes.length > 0 ? (
                    <View style={s.attendeeTimes}>
                      {item.meetingTimes.slice(0, 2).map((t, i) => (
                        <Text key={i} style={s.attendeeTime}>{formatMeetingTime(t.start, t.end)}</Text>
                      ))}
                      {item.meetingTimes.length > 2 ? <Text style={s.attendeeTime}>+{item.meetingTimes.length - 2} more</Text> : null}
                    </View>
                  ) : null}
                </View>
                <ChevronRight size={22} color={colors.textMuted} strokeWidth={2} />
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
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
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.card}
              activeOpacity={0.7}
              onPress={() => router.push(`/expo/${item.id}` as any)}
            >
              {(item as VendorBooth & { banner_url?: string }).banner_url ? (
                <Image source={{ uri: (item as VendorBooth & { banner_url?: string }).banner_url! }} style={s.banner} resizeMode="cover" />
              ) : (
                <View style={s.bannerPlaceholder} />
              )}
              <View style={s.cardInner}>
                <View style={s.cardRow}>
                  {item.logo_url ? (
                    <Image source={{ uri: item.logo_url }} style={s.logo} />
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
                  </View>
                ) : item.booth_location ? (
                  <View style={s.metaRow}>
                    <MapPin size={14} color={colors.textMuted} />
                    <Text style={s.metaText}>{item.booth_location}</Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
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
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    ...(Platform.OS === 'android' ? { elevation: 2 } : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 }),
  },
  banner: { width: '100%', height: 100 },
  bannerPlaceholder: { width: '100%', height: 100, backgroundColor: colors.surface },
  cardInner: { padding: 16 },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  logo: { width: 52, height: 52, borderRadius: 12 },
  logoPlaceholder: {
    width: 52,
    height: 52,
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
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  metaText: { fontSize: 13, color: colors.textMuted },
  websiteBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  websiteText: { fontSize: 13, color: colors.primary },
});
