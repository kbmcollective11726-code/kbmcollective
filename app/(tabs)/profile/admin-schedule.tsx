import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Plus, Pencil, Trash2, Clock, ChevronLeft, Search, X } from 'lucide-react-native';
import { useEventStore } from '../../../stores/eventStore';
import { useAuthStore } from '../../../stores/authStore';
import { supabase } from '../../../lib/supabase';
import { createNotificationAndPush } from '../../../lib/notifications';
import { sendAnnouncementPush } from '../../../lib/pushNotifications';
import { colors, sessionTypeColors } from '../../../constants/colors';
import {
  formatSessionTime,
  groupSessionsByAgendaDay,
} from '../../../lib/scheduleNowNext';
import type { ScheduleSession } from '../../../lib/types';

export default function AdminScheduleScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { currentEvent } = useEventStore();
  const { user } = useAuthStore();

  const goBack = useCallback(() => {
    const returnPath = from && typeof from === 'string' ? decodeURIComponent(from).trim() : null;
    if (returnPath) {
      router.replace(returnPath as any);
    } else {
      router.back();
    }
  }, [from, router]);

  useEffect(() => {
    if (from && typeof from === 'string') {
      navigation.setOptions({
        headerBackVisible: false,
        headerLeft: () => (
          <TouchableOpacity
            onPress={goBack}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
        ),
      });
    }
  }, [from, goBack, navigation]);
  const [sessions, setSessions] = useState<ScheduleSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title?.toLowerCase().includes(q) ||
        s.speaker_name?.toLowerCase().includes(q) ||
        (Array.isArray(s.speakers) && (s.speakers as { name?: string }[]).some((sp) => sp?.name?.toLowerCase().includes(q))) ||
        s.location?.toLowerCase().includes(q) ||
        s.room?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        (s.session_type && s.session_type.toLowerCase().includes(q)) ||
        String(s.day_number ?? '').includes(q)
    );
  }, [sessions, searchQuery]);

  const sessionsByDay = useMemo(
    () =>
      groupSessionsByAgendaDay(
        filteredSessions,
        currentEvent?.start_date,
        currentEvent?.end_date,
        true
      ),
    [filteredSessions, currentEvent?.start_date, currentEvent?.end_date]
  );

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
        .order('day_number', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) throw error;
      setSessions((data ?? []) as ScheduleSession[]);
    } catch (err) {
      console.error('Schedule fetch error:', err);
      setSessions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!currentEvent?.id) {
      setSessions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchSessions().catch(() => {
      if (!cancelled) setSessions([]);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentEvent?.id]);

  useFocusEffect(
    useCallback(() => {
      if (currentEvent?.id) fetchSessions().catch(() => {});
    }, [currentEvent?.id])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchSessions();
  };

  const deleteSession = (session: ScheduleSession) => {
    Alert.alert(
      'Delete session',
      `Remove "${session.title}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Notify event members of session removal (in-app + push) before deleting
              const notifTitle = 'Session removed';
              const notifBody = `"${session.title ?? 'A session'}" was removed from the schedule.`;
              const { data: members } = await supabase
                .from('event_members')
                .select('user_id')
                .eq('event_id', currentEvent?.id);
              const recipientIds = (members ?? [])
                .map((m: { user_id: string }) => m.user_id)
                .filter((id: string) => id !== user?.id);
              for (const uid of recipientIds) {
                await createNotificationAndPush(
                  uid,
                  currentEvent?.id ?? null,
                  'schedule_change',
                  notifTitle,
                  notifBody,
                  {}
                );
              }
              const { data: { session: authSession } } = await supabase.auth.getSession();
              if (authSession?.access_token && currentEvent?.id && recipientIds.length > 0) {
                sendAnnouncementPush(
                  authSession.access_token,
                  currentEvent.id,
                  notifTitle,
                  notifBody,
                  recipientIds
                ).catch(() => {});
              }
              // Remove bookmarks for this session first (foreign key), then delete session
              await supabase.from('user_schedule').delete().eq('session_id', session.id);
              const { error } = await supabase
                .from('schedule_sessions')
                .delete()
                .eq('id', session.id);
              if (error) throw error;
              setSessions((prev) => prev.filter((s) => s.id !== session.id));
            } catch (err: unknown) {
              const message =
                err instanceof Error
                  ? err.message
                  : typeof (err as { message?: string })?.message === 'string'
                    ? (err as { message: string }).message
                    : 'Failed to delete.';
              if (__DEV__ && err) console.error('Schedule delete error:', err);
              Alert.alert('Error', message);
            }
          },
        },
      ]
    );
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.subtitle}>Select an event on the Info tab first.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => router.push('/profile/admin-schedule-edit')}
        activeOpacity={0.8}
      >
        <Plus size={20} color="#fff" />
        <Text style={styles.addButtonText}>Add session</Text>
      </TouchableOpacity>

      {!loading && sessions.length > 0 && (
        <View style={styles.searchWrap}>
          <Search size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search sessions by title, speaker, location…"
            placeholderTextColor={colors.textMuted}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
              <X size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.subtitle}>Loading schedule…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
        >
          {sessions.length === 0 ? (
            <View style={styles.placeholder}>
              <Text style={styles.title}>No sessions yet</Text>
              <Text style={styles.subtitle}>
                Tap "Add session" above to create the first one. Sessions appear in the Schedule tab and on the live wall.
              </Text>
            </View>
          ) : filteredSessions.length === 0 ? (
            <View style={styles.placeholder}>
              <Text style={styles.title}>No matching sessions</Text>
              <Text style={styles.subtitle}>Try a different search.</Text>
            </View>
          ) : (
            sessionsByDay.map((group) => (
              <View key={group.dateKey} style={styles.daySection}>
                <View style={styles.daySectionHead}>
                  {group.dayNum != null ? (
                    <Text style={styles.dayHeading}>
                      Day {group.dayNum}
                      {group.dateLabel ? (
                        <Text style={styles.dayHeadingMuted}> — {group.dateLabel}</Text>
                      ) : null}
                    </Text>
                  ) : (
                    <Text style={styles.dayHeading}>{group.dateLabel}</Text>
                  )}
                  <Text style={styles.dayBadge}>
                    {group.items.length} session{group.items.length === 1 ? '' : 's'}
                  </Text>
                </View>
                {group.items.map((session) => {
                  const firstType = session.session_type?.split(',')[0]?.trim() ?? '';
                  const typeColor = sessionTypeColors[firstType] ?? colors.primary;
                  return (
                    <View key={session.id} style={[styles.card, { borderLeftColor: typeColor }]}>
                      <View style={styles.cardBody}>
                        <Text style={styles.cardTitle}>{session.title}</Text>
                        <View style={styles.meta}>
                          <Clock size={14} color={colors.textMuted} />
                          <Text style={styles.metaText}>
                            {formatSessionTime(session.start_time)} – {formatSessionTime(session.end_time)}
                          </Text>
                        </View>
                        {(Array.isArray(session.speakers) && session.speakers.length > 0
                          ? (session.speakers as { name?: string }[]).map((s) => s?.name).filter(Boolean).join(', ')
                          : session.speaker_name) && (
                          <Text style={styles.speaker}>
                            {Array.isArray(session.speakers) && session.speakers.length > 0
                              ? (session.speakers as { name?: string }[]).map((s) => s?.name).filter(Boolean).join(', ')
                              : session.speaker_name}
                          </Text>
                        )}
                      </View>
                      <View style={styles.actions}>
                        <TouchableOpacity
                          onPress={() =>
                            router.push({ pathname: '/profile/admin-schedule-edit', params: { id: session.id } } as any)
                          }
                          style={styles.iconBtn}
                        >
                          <Pencil size={20} color={colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => deleteSession(session)} style={styles.iconBtn}>
                          <Trash2 size={20} color={colors.danger} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  addButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
  },
  scrollContent: { padding: 16, paddingBottom: 32 },
  daySection: { marginBottom: 20 },
  daySectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  dayHeading: { fontSize: 15, fontWeight: '700', color: colors.text },
  dayHeadingMuted: { fontWeight: '600', color: colors.textSecondary },
  dayBadge: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 12,
    padding: 14,
    borderLeftWidth: 4,
    borderColor: colors.border,
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: colors.textMuted },
  speaker: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12 },
  iconBtn: { padding: 4 },
  backButton: { padding: 8, marginLeft: 4 },
});
