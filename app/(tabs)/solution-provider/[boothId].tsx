import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronRight, ExternalLink, MapPin, Store } from 'lucide-react-native';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, supabaseStorage } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';
import type { VendorBooth } from '../../../lib/types';
import { Platform } from 'react-native';
import SolutionNavBack, { navigateSolutionBack } from '../../../components/SolutionNavBack';
import Avatar from '../../../components/Avatar';
import { fetchBoothRepresentatives, type BoothRepresentative } from '../../../lib/vendorBoothReps';

export default function SolutionProviderDetailScreen() {
  const params = useLocalSearchParams<{ boothId: string; from?: string }>();
  const boothId = typeof params.boothId === 'string' ? params.boothId : Array.isArray(params.boothId) ? params.boothId[0] : '';
  const from = typeof params.from === 'string' ? params.from : Array.isArray(params.from) ? params.from[0] : '';
  const router = useRouter();
  const { currentEvent } = useEventStore();
  const [booth, setBooth] = useState<VendorBooth | null>(null);
  const [representatives, setRepresentatives] = useState<BoothRepresentative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    navigateSolutionBack(router, from);
  }, [from, router]);

  useEffect(() => {
    const load = async () => {
      if (!boothId || !currentEvent?.id) {
        setBooth(null);
        setRepresentatives([]);
        setLoading(false);
        return;
      }
      setError(null);
      const client = Platform.OS === 'android' ? supabaseStorage : supabase;
      try {
        const { data, error: fetchError } = await client
          .from('vendor_booths')
          .select('*')
          .eq('id', boothId)
          .eq('event_id', currentEvent.id)
          .eq('is_active', true)
          .maybeSingle();
        if (fetchError) throw fetchError;
        if (!data) {
          setBooth(null);
          setRepresentatives([]);
          setError('Solution provider not found.');
          return;
        }
        const boothRow = data as VendorBooth;
        setBooth(boothRow);
        try {
          setRepresentatives(await fetchBoothRepresentatives(boothRow, client));
        } catch {
          setRepresentatives([]);
        }
      } catch (err) {
        setBooth(null);
        setRepresentatives([]);
        setError(err instanceof Error ? err.message : 'Could not load solution provider.');
      } finally {
        setLoading(false);
      }
    };
    load().catch(() => {});
  }, [boothId, currentEvent?.id]);

  return (
    <SafeAreaView style={s.container} edges={[]}>
      <Stack.Screen
        options={{
          title: booth?.vendor_name ?? 'Solution Provider',
          headerLeft: () => <SolutionNavBack fromParam={from} />,
        }}
      />
      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.loadingText}>Loading solution provider...</Text>
        </View>
      ) : error || !booth ? (
        <View style={s.centered}>
          <Text style={s.errorText}>{error ?? 'Solution provider not found.'}</Text>
          <TouchableOpacity style={s.backBtn} onPress={goBack} activeOpacity={0.8}>
            <Text style={s.backBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.hero}>
            {booth.logo_url ? (
              <Image source={{ uri: booth.logo_url }} style={s.logo} resizeMode="contain" />
            ) : (
              <View style={s.logoPlaceholder}>
                <Store size={34} color={colors.textMuted} />
              </View>
            )}
            <Text style={s.name}>{booth.vendor_name}</Text>
          </View>

          {booth.description ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>About</Text>
              <Text style={s.body}>{booth.description}</Text>
            </View>
          ) : null}

          {representatives.length > 0 ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Representatives</Text>
              {representatives.map((rep) => {
                const subtitle = [rep.title, rep.company].filter(Boolean).join(' · ');
                return (
                  <TouchableOpacity
                    key={rep.user_id}
                    style={s.repRow}
                    activeOpacity={0.75}
                    onPress={() => router.push(`/(tabs)/feed/user/${rep.user_id}` as any)}
                  >
                    <Avatar uri={rep.avatar_url} name={rep.full_name} size={44} />
                    <View style={s.repTextCol}>
                      <Text style={s.repName} numberOfLines={1}>
                        {rep.full_name}
                      </Text>
                      {subtitle ? (
                        <Text style={s.repSubtitle} numberOfLines={2}>
                          {subtitle}
                        </Text>
                      ) : (
                        <Text style={s.repSubtitleMuted}>View profile</Text>
                      )}
                    </View>
                    <ChevronRight size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {booth.booth_location ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Booth location</Text>
              <View style={s.row}>
                <MapPin size={16} color={colors.textMuted} />
                <Text style={s.body}>{booth.booth_location}</Text>
              </View>
            </View>
          ) : null}

          {booth.website ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>Website</Text>
              <TouchableOpacity onPress={() => Linking.openURL(booth.website!).catch(() => {})} style={s.linkRow} activeOpacity={0.7}>
                <ExternalLink size={16} color={colors.primary} />
                <Text style={s.linkText}>{booth.website}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  loadingText: { marginTop: 10, color: colors.textSecondary, fontSize: 15 },
  errorText: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  backBtn: { marginTop: 14, backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  backBtnText: { color: '#fff', fontWeight: '700' },
  content: { padding: 18, gap: 14 },
  hero: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  logo: { width: 84, height: 84, borderRadius: 16, backgroundColor: colors.surface },
  logoPlaceholder: {
    width: 84,
    height: 84,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { marginTop: 12, fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  body: { fontSize: 15, color: colors.text, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkText: { flex: 1, color: colors.primary, fontSize: 15 },
  repRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 4,
  },
  repTextCol: { flex: 1, minWidth: 0 },
  repName: { fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 },
  repSubtitle: { marginTop: 2, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  repSubtitleMuted: { marginTop: 2, fontSize: 13, color: colors.textMuted },
});
