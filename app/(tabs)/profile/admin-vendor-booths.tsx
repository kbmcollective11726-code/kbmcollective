import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronRight, PlusCircle, Store } from 'lucide-react-native';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, supabaseStorage } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';
import type { VendorBooth } from '../../../lib/types';

export default function AdminVendorBoothsScreen() {
  const router = useRouter();
  const { currentEvent } = useEventStore();
  const [booths, setBooths] = useState<VendorBooth[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBooths = useCallback(async () => {
    if (!currentEvent?.id) {
      setBooths([]);
      setLoading(false);
      return;
    }
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      const { data, error } = await client
        .from('vendor_booths')
        .select('*')
        .eq('event_id', currentEvent.id)
        .order('vendor_name');
      if (error) throw error;
      setBooths((data ?? []) as VendorBooth[]);
    } catch (e) {
      console.error('Fetch vendor booths error:', e);
      setBooths([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentEvent?.id]);

  useEffect(() => {
    if (currentEvent?.id) {
      setLoading(true);
      fetchBooths();
    }
  }, [currentEvent?.id, fetchBooths]);

  if (!currentEvent) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <View style={s.centered}>
          <Text style={s.emptyText}>Select an event first.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <TouchableOpacity
        style={s.addBtn}
        onPress={() => router.push('/profile/admin-vendor-booth-edit')}
      >
        <PlusCircle size={22} color="#fff" />
        <Text style={s.addBtnText}>Add vendor booth</Text>
      </TouchableOpacity>
      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : booths.length === 0 ? (
        <View style={s.centered}>
          <Store size={48} color={colors.textMuted} />
          <Text style={s.emptyText}>No vendor booths yet.</Text>
          <Text style={s.emptySub}>Tap "Add vendor booth" to add one, then add meeting slots so you can assign attendees.</Text>
        </View>
      ) : (
        <FlatList
          data={booths}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchBooths(); }} colors={[colors.primary]} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push({ pathname: '/profile/admin-vendor-booth-edit', params: { id: item.id } } as any)}
              activeOpacity={0.7}
            >
              <Text style={s.vendorName}>{item.vendor_name}</Text>
              {item.booth_location ? <Text style={s.meta}>{item.booth_location}</Text> : null}
              <ChevronRight size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  addBtn: {
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
  addBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  listContent: { padding: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vendorName: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted, marginRight: 8 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 16, color: colors.textSecondary, textAlign: 'center' },
  emptySub: { marginTop: 8, fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 24 },
});
