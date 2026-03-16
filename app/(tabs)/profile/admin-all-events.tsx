import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronRight, Trash2 } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';
import type { Event } from '../../../lib/types';

export default function AdminAllEventsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { allEvents, fetchAllEvents, setCurrentEvent, currentEvent, fetchMyMemberships, isLoading, error } = useEventStore();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isPlatformAdmin = user?.is_platform_admin === true;

  useEffect(() => {
    if (isPlatformAdmin) fetchAllEvents();
  }, [isPlatformAdmin, fetchAllEvents]);

  useFocusEffect(
    useCallback(() => {
      if (isPlatformAdmin) fetchAllEvents().catch(() => {});
    }, [isPlatformAdmin, fetchAllEvents])
  );

  const handleToggleActive = async (event: Event) => {
    if (togglingId) return;
    setTogglingId(event.id);
    try {
      const { error: err } = await supabase
        .from('events')
        .update({ is_active: !event.is_active, updated_at: new Date().toISOString() })
        .eq('id', event.id);
      if (err) throw err;
      await fetchAllEvents();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update event.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleSelectEvent = async (event: Event) => {
    await setCurrentEvent(event);
    router.replace('/(tabs)/home');
  };

  const handleDeleteEvent = (event: Event) => {
    Alert.alert(
      'Delete event',
      `Permanently delete "${event.name}" and all its content (posts, schedule, members, announcements, etc.)? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (deletingId) return;
            setDeletingId(event.id);
            try {
              const { error: err } = await supabase.from('events').delete().eq('id', event.id);
              if (err) throw err;
              if (currentEvent?.id === event.id && user?.id) {
                await setCurrentEvent(null);
                await fetchMyMemberships(user.id, true);
              }
              await fetchAllEvents();
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete event.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.subtitle}>Sign in to continue.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.subtitle}>You don’t have access to manage all events.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>All events</Text>
        <Text style={styles.hint}>Tap an event to manage it. Toggle to enable or disable.</Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : (
          <View style={styles.list}>
            {allEvents.length === 0 ? (
              <Text style={styles.empty}>No events found.</Text>
            ) : (
              allEvents.map((event, index) => (
                <View key={event.id} style={[styles.row, index === 0 && styles.rowFirst]}>
                  <TouchableOpacity
                    style={styles.rowMain}
                    onPress={() => handleSelectEvent(event)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.eventName}>{event.name}</Text>
                      <Text style={styles.eventMeta}>
                        {event.event_code ?? '—'} · {event.start_date} – {event.end_date}
                        {!event.is_active ? ' · Disabled' : ''}
                      </Text>
                    </View>
                    <ChevronRight size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                  <View style={styles.toggleWrap}>
                    {togglingId === event.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <>
                        <Text style={styles.toggleLabel}>{event.is_active ? 'On' : 'Off'}</Text>
                        <Switch
                          value={event.is_active}
                          onValueChange={() => handleToggleActive(event)}
                          trackColor={{ false: colors.border, true: colors.primaryLight }}
                          thumbColor={colors.background}
                        />
                      </>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDeleteEvent(event)}
                    disabled={!!deletingId}
                  >
                    {deletingId === event.id ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <Trash2 size={22} color={colors.danger} />
                    )}
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 8 },
  hint: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  errorText: { fontSize: 14, color: colors.danger, marginBottom: 12 },
  loader: { marginVertical: 24 },
  list: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  eventName: { fontSize: 16, fontWeight: '600', color: colors.text },
  eventMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  toggleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleLabel: { fontSize: 13, color: colors.textSecondary },
  deleteBtn: { padding: 8, marginLeft: 4, justifyContent: 'center', alignItems: 'center' },
  empty: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 24 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
});
