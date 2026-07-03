import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { ExternalLink, MapPin, Store } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useEventStore } from '../../stores/eventStore';
import { supabase, supabaseStorage } from '../../lib/supabase';
import { colors } from '../../constants/colors';
import type { VendorBooth } from '../../lib/types';
import HamburgerMenu from '../../components/HamburgerMenu';

export default function SolutionProvidersScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const { from: upstreamFrom } = useLocalSearchParams<{ from?: string | string[] }>();
  const { currentEvent } = useEventStore();
  const [booths, setBooths] = useState<VendorBooth[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBooths = useCallback(async () => {
    if (!currentEvent?.id) {
      setBooths([]);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return;
    }
    setError(null);
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      const { data, error: fetchError } = await client
        .from('vendor_booths')
        .select('*')
        .eq('event_id', currentEvent.id)
        .eq('is_active', true)
        .order('vendor_name');
      if (fetchError) throw fetchError;
      setBooths((data ?? []) as VendorBooth[]);
    } catch (err) {
      setBooths([]);
      setError(err instanceof Error ? err.message : 'Could not load solution providers.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentEvent?.id]);

  useEffect(() => {
    setLoading(true);
    fetchBooths().catch(() => {});
  }, [fetchBooths]);

  useFocusEffect(
    useCallback(() => {
      if (currentEvent?.id) fetchBooths().catch(() => {});
    }, [currentEvent?.id, fetchBooths])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchBooths().catch(() => {});
  };

  const listReturnHref = useMemo(() => {
    const raw = upstreamFrom;
    const enc =
      typeof raw === 'string' ? raw : Array.isArray(raw) && raw[0] ? raw[0] : '';
    if (enc) return `${pathname}?from=${encodeURIComponent(enc)}`;
    return pathname;
  }, [pathname, upstreamFrom]);

  return (
    <SafeAreaView style={s.container} edges={[]}>
      <Stack.Screen options={{ title: 'Solution Providers', headerLeft: () => <HamburgerMenu /> }} />
      {error ? (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>Loading solution providers...</Text>
        </View>
      ) : booths.length === 0 ? (
        <View style={s.centered}>
          <Text style={s.emptyText}>No solution providers yet.</Text>
          <Text style={s.emptySubtext}>Vendors added by event admin will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={booths}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.card}
              activeOpacity={0.8}
              onPress={() =>
                router.push(
                  `/(tabs)/solution-provider/${item.id}?from=${encodeURIComponent(listReturnHref)}` as any
                )
              }
            >
              <View style={s.cardRow}>
                {item.logo_url ? (
                  <Image source={{ uri: item.logo_url }} style={s.logo} resizeMode="contain" />
                ) : (
                  <View style={s.logoPlaceholder}>
                    <Store size={26} color={colors.textMuted} />
                  </View>
                )}
                <View style={s.cardBody}>
                  <Text style={s.vendorName} numberOfLines={1}>
                    {item.vendor_name}
                  </Text>
                  {item.description ? (
                    <Text style={s.description} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                  {item.booth_location ? (
                    <View style={s.metaRow}>
                      <MapPin size={14} color={colors.textMuted} />
                      <Text style={s.metaText} numberOfLines={1}>
                        {item.booth_location}
                      </Text>
                    </View>
                  ) : null}
                  {item.website ? (
                    <TouchableOpacity
                      style={s.websiteRow}
                      onPress={() => Linking.openURL(item.website!).catch(() => {})}
                      activeOpacity={0.7}
                    >
                      <ExternalLink size={14} color={colors.primary} />
                      <Text style={s.websiteText} numberOfLines={1}>
                        {item.website}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  loadingText: { marginTop: 10, color: colors.textSecondary, fontSize: 15 },
  emptyText: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptySubtext: { marginTop: 8, color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  errorBanner: {
    margin: 16,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    backgroundColor: '#fef2f2',
    padding: 10,
  },
  errorText: { color: colors.danger, fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
  },
  cardRow: { flexDirection: 'row', gap: 12 },
  cardBody: { flex: 1 },
  logo: { width: 56, height: 56, borderRadius: 12, backgroundColor: colors.background },
  logoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vendorName: { fontSize: 17, fontWeight: '700', color: colors.text },
  description: { marginTop: 4, fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  metaRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flex: 1, fontSize: 13, color: colors.textMuted },
  websiteRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  websiteText: { flex: 1, fontSize: 13, color: colors.primary },
});
