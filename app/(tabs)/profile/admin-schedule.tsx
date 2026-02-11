import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { Plus, Pencil, Trash2, Clock, ChevronLeft } from 'lucide-react-native';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { colors, sessionTypeColors } from '../../../constants/colors';
import type { ScheduleSession } from '../../../lib/types';
import { format } from 'date-fns';

export default function AdminScheduleScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { currentEvent } = useEventStore();

  useEffect(() => {
    if (from && typeof from === 'string') {
      const returnPath = decodeURIComponent(from);
      navigation.setOptions({
        headerBackVisible: false,
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => router.replace(returnPath as any)}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
        ),
      });
    }
  }, [from, navigation, router]);
  const [sessions, setSessions] = useState<ScheduleSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
    fetchSessions();
  }, [currentEvent?.id]);

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
              const { error } = await supabase
                .from('schedule_sessions')
                .delete()
                .eq('id', session.id);
              if (error) throw error;
              setSessions((prev) => prev.filter((s) => s.id !== session.id));
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete.');
            }
          },
        },
      ]
    );
  };

  const formatTime = (iso: string) => format(new Date(iso), 'EEE M/d · h:mm a');

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
          ) : (
            sessions.map((session) => {
              const typeColor = sessionTypeColors[session.session_type] ?? colors.primary;
              return (
                <View key={session.id} style={[styles.card, { borderLeftColor: typeColor }]}>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{session.title}</Text>
                    <View style={styles.meta}>
                      <Clock size={14} color={colors.textMuted} />
                      <Text style={styles.metaText}>
                        Day {session.day_number} · {formatTime(session.start_time)} – {format(new Date(session.end_time), 'h:mm a')}
                      </Text>
                    </View>
                    {session.speaker_name && (
                      <Text style={styles.speaker}>{session.speaker_name}</Text>
                    )}
                  </View>
                  <View style={styles.actions}>
                    <TouchableOpacity
                      onPress={() => router.push({ pathname: '/profile/admin-schedule-edit', params: { id: session.id } } as any)}
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
            })
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
  scrollContent: { padding: 16, paddingBottom: 32 },
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
