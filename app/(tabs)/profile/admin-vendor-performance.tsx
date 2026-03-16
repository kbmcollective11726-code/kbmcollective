import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Star, TrendingUp, ThumbsUp, Award } from 'lucide-react-native';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, supabaseStorage } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';

type BoothPerformance = {
  booth_id: string;
  vendor_name: string;
  feedback_count: number;
  avg_rating: number | null;
  pct_meet_again: number | null;
  pct_recommend: number | null;
  avg_work_with_likelihood: number | null;
};

export default function AdminVendorPerformanceScreen() {
  const router = useRouter();
  const { currentEvent } = useEventStore();
  const [list, setList] = useState<BoothPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPerformance = useCallback(async () => {
    if (!currentEvent?.id) {
      setList([]);
      setLoading(false);
      return;
    }
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      const { data, error } = await client.rpc('get_b2b_vendor_performance', {
        p_event_id: currentEvent.id,
        p_booth_id: null,
      });
      if (error) throw error;
      const arr = Array.isArray(data) ? data : [];
      setList(arr as BoothPerformance[]);
    } catch (e) {
      console.error('Fetch vendor performance error:', e);
      setList([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentEvent?.id]);

  useEffect(() => {
    if (currentEvent?.id) {
      setLoading(true);
      fetchPerformance();
    }
  }, [currentEvent?.id, fetchPerformance]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPerformance();
  };

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <ChevronLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Vendor performance</Text>
      </View>
      <Text style={s.subtitle}>B2B meeting ratings by booth. Pull down to refresh.</Text>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : list.length === 0 ? (
        <View style={s.centered}>
          <Award size={48} color={colors.textMuted} style={{ marginBottom: 12 }} />
          <Text style={s.emptyText}>No vendor feedback yet.</Text>
          <Text style={s.emptyHint}>Attendees can rate meetings from the booth screen after a meeting.</Text>
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        >
          {list.map((row) => (
            <View key={row.booth_id} style={s.card}>
              <Text style={s.vendorName}>{row.vendor_name}</Text>
              <View style={s.statsRow}>
                <View style={s.stat}>
                  <Star size={18} color={colors.primary} />
                  <Text style={s.statValue}>{row.avg_rating != null ? Number(row.avg_rating).toFixed(1) : '—'}</Text>
                  <Text style={s.statLabel}>Avg rating</Text>
                </View>
                <View style={s.stat}>
                  <Text style={s.statValue}>{row.feedback_count}</Text>
                  <Text style={s.statLabel}>Ratings</Text>
                </View>
                <View style={s.stat}>
                  <ThumbsUp size={18} color={colors.primary} />
                  <Text style={s.statValue}>{row.pct_meet_again != null ? `${Number(row.pct_meet_again).toFixed(0)}%` : '—'}</Text>
                  <Text style={s.statLabel}>Meet again</Text>
                </View>
                <View style={s.stat}>
                  <Text style={s.statValue}>{row.pct_recommend != null ? `${Number(row.pct_recommend).toFixed(0)}%` : '—'}</Text>
                  <Text style={s.statLabel}>Recommend</Text>
                </View>
                <View style={s.stat}>
                  <TrendingUp size={18} color={colors.primary} />
                  <Text style={s.statValue}>{row.avg_work_with_likelihood != null ? Number(row.avg_work_with_likelihood).toFixed(1) : '—'}</Text>
                  <Text style={s.statLabel}>Work with (1–5)</Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { padding: 8, marginRight: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textSecondary, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 16, color: colors.textSecondary, marginBottom: 8 },
  emptyHint: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  vendorName: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 12 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  stat: { alignItems: 'center', minWidth: 56 },
  statValue: { fontSize: 16, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
