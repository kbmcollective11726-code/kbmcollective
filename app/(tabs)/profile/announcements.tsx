import { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, withRetryAndRefresh } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';
import { format } from 'date-fns';
import { Megaphone } from 'lucide-react-native';

type AnnouncementRow = { id: string; title: string; content: string; created_at: string };

export default function AnnouncementsScreen() {
  const { currentEvent } = useEventStore();
  const [items, setItems] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchAnnouncements = async () => {
    if (!currentEvent?.id) {
      setItems([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    setFetchError(null);
    try {
      await withRetryAndRefresh(async () => {
        const { data, error } = await supabase
          .from('announcements')
          .select('id, title, content, created_at')
          .eq('event_id', currentEvent.id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        setItems((data ?? []) as AnnouncementRow[]);
      });
      setFetchError(null);
    } catch (err) {
      if (__DEV__) console.warn('Announcements fetch error:', err);
      setItems([]);
      setFetchError(err instanceof Error ? err.message : 'Could not load announcements.');
    } finally {
      setLoading(false);
    }
  };

  // Like Info: run and wait. No timer so first try can complete.
  useEffect(() => {
    if (!currentEvent?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchAnnouncements()
      .catch(() => { if (!cancelled) setTimeout(() => fetchAnnouncements().finally(() => {}), 2000); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentEvent?.id]);

  useFocusEffect(
    useCallback(() => {
      if (currentEvent?.id) fetchAnnouncements().catch(() => {});
    }, [currentEvent?.id])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && currentEvent?.id) fetchAnnouncements().catch(() => {});
    });
    return () => sub.remove();
  }, [currentEvent?.id]);

  const loadingStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (!loading) {
      loadingStartRef.current = null;
      return;
    }
    loadingStartRef.current = Date.now();
    const t = setTimeout(() => {
      if (loadingStartRef.current !== null && Date.now() - loadingStartRef.current >= 40000) {
        setLoading(false);
        setFetchError('Could not load announcements.');
      }
    }, 40000);
    return () => clearTimeout(t);
  }, [loading]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAnnouncements();
    setRefreshing(false);
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Megaphone size={48} color={colors.textMuted} />
          <Text style={styles.placeholderTitle}>Select an event</Text>
          <Text style={styles.placeholderSubtitle}>Choose an event on the Info tab to see announcements.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.placeholderTitle}>Loading announcements…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Megaphone size={48} color={colors.textMuted} />
          <Text style={styles.placeholderTitle}>Couldn't load announcements</Text>
          <Text style={styles.placeholderSubtitle}>{fetchError}</Text>
          <TouchableOpacity
            onPress={() => {
              setFetchError(null);
              setLoading(true);
              fetchAnnouncements();
            }}
            style={styles.retryBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.placeholder}>
            <Megaphone size={48} color={colors.textMuted} />
            <Text style={styles.placeholderTitle}>No announcements yet</Text>
            <Text style={styles.placeholderSubtitle}>When admins send announcements for this event, they’ll show here.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{String(item.title)}</Text>
            <Text style={styles.cardContent}>{String(item.content)}</Text>
            <Text style={styles.cardDate}>{format(new Date(item.created_at), 'MMM d, yyyy · h:mm a')}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, paddingBottom: 32 },
  emptyList: { flex: 1 },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  placeholderTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 16, textAlign: 'center' },
  placeholderSubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 8, textAlign: 'center' },
  retryBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  retryBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8 },
  cardContent: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
  cardDate: { fontSize: 12, color: colors.textMuted, marginTop: 10 },
});
