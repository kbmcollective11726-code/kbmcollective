import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { Users, PlusCircle } from 'lucide-react-native';
import { useAuthStore } from '../../../../stores/authStore';
import { useEventStore } from '../../../../stores/eventStore';
import { useRolePreviewContext } from '../../../../hooks/useRolePreviewContext';
import { supabase, withRetryAndRefresh, refreshSessionIfNeeded, getErrorMessage } from '../../../../lib/supabase';
import { registerRefetchOnSessionRefreshed } from '../../../../lib/onSessionRefreshed';
import { addDebugLog } from '../../../../lib/debugLog';
import { colors } from '../../../../constants/colors';
import { themeColorWithAlpha, useEventThemeColor } from '../../../../lib/eventTheme';
import { groupChatHref, navigateBackToFrom, newGroupHref } from '../../../../lib/navReturn';
import Avatar from '../../../../components/Avatar';
import ProfileStackScreenHeader from '../../../../components/ProfileStackScreenHeader';

type ChatGroup = {
  id: string;
  event_id: string;
  name: string;
  created_by: string;
  created_at: string;
  member_count?: number;
};


export default function GroupsListScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const isFocused = useIsFocused();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const { applyEventAdmin } = useRolePreviewContext();
  const themeColor = useEventThemeColor();
  const themeFaded = themeColorWithAlpha(themeColor, '18');
  const [groups, setGroups] = useState<ChatGroup[]>([]);

  const goBack = useCallback(() => {
    navigateBackToFrom(router, from, '/(tabs)/profile');
  }, [router, from]);

  useEffect(() => {
    if (__DEV__) console.log('[Groups] component did mount');
    return () => {
      if (__DEV__) console.log('[Groups] component will unmount');
    };
  }, []);

  useEffect(() => {
    if ((!user?.id || !currentEvent?.id) && __DEV__) console.log('[Groups] user session null or expired or no event — user?.id:', user?.id, 'currentEvent?.id:', currentEvent?.id);
  }, [user?.id, currentEvent?.id]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchErrorDetail, setFetchErrorDetail] = useState<string | null>(null);

  const fetchAdmin = useCallback(async (): Promise<boolean> => {
    if (!user?.id || !currentEvent?.id) {
      if (__DEV__) console.log('[Groups] fetchAdmin skipped — no user or event');
      setIsEventAdmin(false);
      return false;
    }
    const { data, error } = await supabase
      .from('event_members')
      .select('role, roles')
      .eq('event_id', currentEvent.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (__DEV__) console.log('[Groups] Supabase event_members (fetchAdmin) — data:', data, 'error:', error);
    const row = data as { role?: string; roles?: string[] } | null;
    const role = row?.role ?? 'attendee';
    const roles = Array.isArray(row?.roles) ? row.roles : [];
    const admin =
      role === 'admin' ||
      role === 'super_admin' ||
      roles.includes('admin') ||
      roles.includes('super_admin');
    setIsEventAdmin(admin);
    return admin;
  }, [user?.id, currentEvent?.id]);

  const effectiveIsEventAdmin = applyEventAdmin(isEventAdmin);

  const fetchInProgressRef = useRef(false);
  const fetchGroups = useCallback(async (_adminOverride?: boolean) => {
    if (!user?.id || !currentEvent?.id) {
      if (__DEV__) console.log('[Groups] fetch skipped — no user or event');
      setGroups([]);
      setFetchError(null);
      setLoading(false);
      return;
    }
    if (fetchInProgressRef.current) {
      if (__DEV__) console.log('[Groups] fetch skipped — already in progress');
      return;
    }
    if (__DEV__) console.log('[Groups] fetch starting');
    fetchInProgressRef.current = true;
    setLoading(true);
    setFetchError(null);
    setFetchErrorDetail(null);
    addDebugLog('Groups', 'Load started');
    try {
      await withRetryAndRefresh(async () => {
        const { data: groupRows, error } = await supabase
          .from('chat_groups')
          .select('id, event_id, name, created_by, created_at')
          .eq('event_id', currentEvent.id)
          .order('created_at', { ascending: false });

        if (__DEV__) console.log('[Groups] Supabase chat_groups query — data:', groupRows, 'error:', error);
        if (error) throw error;
        const rows = (groupRows ?? []) as ChatGroup[];
        if (!rows.length) {
          setGroups([]);
          return;
        }
        await Promise.all(
          rows
            .filter((g: ChatGroup) => g.created_by === user?.id)
            .map((g: ChatGroup) =>
              supabase.from('chat_group_members').insert({ group_id: g.id, user_id: user!.id }).select().then(
                (res) => {
                  if (__DEV__) console.log('[Groups] Supabase chat_group_members insert — group:', g.id, 'data:', res.data, 'error:', res.error);
                },
                (err: unknown) => {
                  if (__DEV__) console.log('[Groups] Supabase chat_group_members insert failed — exact error object:', err);
                }
              )
            )
        );
        const withCount = await Promise.all(
          rows.map(async (g: ChatGroup) => {
            const { data: rpcCount, error: rpcError } = await supabase.rpc('get_chat_group_member_count', { p_group_id: g.id });
            if (__DEV__) console.log('[Groups] Supabase get_chat_group_member_count — group:', g.id, 'data:', rpcCount, 'error:', rpcError);
            if (typeof rpcCount === 'number') return { ...g, member_count: rpcCount };
            const { count } = await supabase
              .from('chat_group_members')
              .select('id', { count: 'exact', head: true })
              .eq('group_id', g.id);
            return { ...g, member_count: count ?? 0 };
          })
        );
        if (__DEV__) console.log('[Groups] Supabase fetchGroups returned data (count):', withCount?.length ?? 0);
        setGroups(withCount);
      });
      setFetchError(null);
      setFetchErrorDetail(null);
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      addDebugLog('Groups', 'Load failed', msg);
      if (__DEV__) console.log('[Groups] Supabase call failed — exact error object:', err);
      setFetchError('Error - page not loading');
      setFetchErrorDetail(msg);
      setGroups([]);
    } finally {
      fetchInProgressRef.current = false;
      setLoading(false);
    }
  }, [user?.id, currentEvent?.id]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id && currentEvent?.id) {
        fetchAdmin().then((admin) => fetchGroups(admin)).catch(() => {});
      }
    }, [user?.id, currentEvent?.id, fetchAdmin, fetchGroups])
  );

  useEffect(() => {
    const unregister = registerRefetchOnSessionRefreshed(() => {
      if (user?.id && currentEvent?.id) {
        fetchAdmin().then((admin) => fetchGroups(admin)).catch(() => {});
      }
    });
    return unregister;
  }, [user?.id, currentEvent?.id, fetchAdmin, fetchGroups]);

  const screenLoadTimeoutMs = 30000;
  const loadingStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (!loading) {
      loadingStartRef.current = null;
      return;
    }
    loadingStartRef.current = Date.now();
    const t = setTimeout(() => {
      if (loadingStartRef.current !== null && Date.now() - loadingStartRef.current >= screenLoadTimeoutMs) {
        addDebugLog('Groups', 'Load timed out', 'Request never completed — check network or Supabase');
        setLoading(false);
        setFetchError('Error - page not loading');
        setFetchErrorDetail('Timed out');
      }
    }, screenLoadTimeoutMs);
    return () => clearTimeout(t);
  }, [loading, user?.id, currentEvent?.id, fetchAdmin, fetchGroups]);

  const onRefresh = async () => {
    setRefreshing(true);
    setFetchError(null);
    addDebugLog('Groups', 'Pull-to-refresh started');
    if (__DEV__) Toast.show({ type: 'info', text1: 'Refreshing...', visibilityTime: 1500 });
    try {
      await refreshSessionIfNeeded();
      const admin = await fetchAdmin();
      await fetchGroups(admin);
      addDebugLog('Groups', 'Pull-to-refresh finished');
      if (__DEV__) Toast.show({ type: 'success', text1: 'Refresh done', visibilityTime: 2000 });
    } catch (e) {
      const msg = getErrorMessage(e);
      addDebugLog('Groups', 'Pull-to-refresh failed', msg);
      if (__DEV__) console.log('[Groups] onRefresh failed — exact error object:', e);
      if (__DEV__) Toast.show({ type: 'error', text1: 'Refresh failed', text2: msg.slice(0, 50), visibilityTime: 4000 });
      setFetchError('Error - page not loading');
    } finally {
      setRefreshing(false);
    }
  };

  if (!currentEvent?.id || !user?.id) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Groups" onBack={goBack} />
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Select an event to see your groups.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && groups.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Groups" onBack={goBack} />
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={themeColor} />
          <Text style={styles.placeholderText}>Loading groups…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader variant="back" title="Groups" onBack={goBack} />
      {currentEvent?.name ? (
        <View style={styles.eventHeader}>
          <Text style={styles.eventLabel}>Groups for</Text>
          <Text style={styles.eventName} numberOfLines={1}>{currentEvent.name}</Text>
        </View>
      ) : null}
      {fetchError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>Error - page not loading</Text>
          {fetchErrorDetail ? (
            <Text style={[styles.errorHint, { fontStyle: 'italic', marginTop: 4 }]} numberOfLines={2}>
              {fetchErrorDetail}
            </Text>
          ) : null}
          <Text style={styles.errorHint}>Pull down to refresh or tap Try again.</Text>
          {fetchErrorDetail?.toLowerCase().includes('timed out') ? (
            <Text style={[styles.errorHint, { marginTop: 4, fontStyle: 'italic', fontSize: 11 }]}>
              Check Metro console or try: npx expo start --tunnel
            </Text>
          ) : null}
          <TouchableOpacity
            onPress={async () => {
              setFetchError(null);
              setFetchErrorDetail(null);
              setLoading(true);
              try {
                await refreshSessionIfNeeded();
                const admin = await fetchAdmin();
                await fetchGroups(admin);
              } catch (e: unknown) {
                setFetchError('Error - page not loading');
                setFetchErrorDetail(getErrorMessage(e));
              } finally {
                setLoading(false);
              }
            }}
            style={[styles.createBtn, { marginTop: 12, alignSelf: 'center', backgroundColor: themeColor }]}
            activeOpacity={0.8}
          >
            <Text style={styles.createBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {effectiveIsEventAdmin && (
        <TouchableOpacity
          style={[styles.createBtn, { backgroundColor: themeColor }]}
          onPress={() => router.push(newGroupHref(from) as never)}
          activeOpacity={0.8}
        >
          <PlusCircle size={22} color={colors.textOnPrimary} />
          <Text style={styles.createBtnText}>Create group</Text>
        </TouchableOpacity>
      )}
      <FlatList
        style={{ flex: 1 }}
        data={groups}
        keyExtractor={(item) => item.id}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={5}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColor} colors={[themeColor]} />}
        contentContainerStyle={[styles.list, groups.length === 0 && styles.listEmpty, { minHeight: Dimensions.get('window').height + 2 }]}
        ListEmptyComponent={
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>
              {effectiveIsEventAdmin ? 'No groups yet. Create one to get started.' : 'You’re not in any groups yet.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.row, { borderLeftColor: themeColor, borderLeftWidth: 3 }]}
            onPress={() => router.push(groupChatHref(item.id, from) as never)}
            activeOpacity={0.7}
          >
            <View style={[styles.rowIcon, { backgroundColor: themeFaded }]}>
              <Users size={24} color={themeColor} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.rowMeta}>
                {item.member_count ?? 0} member{(item.member_count ?? 0) !== 1 ? 's' : ''}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
      {effectiveIsEventAdmin && (
        <TouchableOpacity
          style={styles.manageLink}
          onPress={() => router.push('/(tabs)/profile/admin')}
          activeOpacity={0.7}
        >
          <Text style={[styles.manageLinkText, { color: themeColor }]}>Event admin → manage event & members</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  eventHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  eventLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  eventName: { fontSize: 16, fontWeight: '600', color: colors.text },
  errorBanner: { marginHorizontal: 16, marginTop: 8, padding: 12, backgroundColor: '#fef2f2', borderRadius: 8, borderWidth: 1, borderColor: '#fecaca' },
  errorText: { fontSize: 14, color: '#b91c1c', fontWeight: '500' },
  errorHint: { fontSize: 12, color: '#b91c1c', marginTop: 6, opacity: 0.9 },
  list: { padding: 16, paddingBottom: 24 },
  listEmpty: { flexGrow: 1 },
  placeholder: { paddingVertical: 32, alignItems: 'center' },
  placeholderText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  emptyHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 16, paddingHorizontal: 24, lineHeight: 20 },
  switchEventBtn: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 16 },
  switchEventBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  manageLink: { padding: 16, alignItems: 'center', paddingBottom: 24 },
  manageLinkText: { fontSize: 13, color: colors.primary },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  createBtnText: { fontSize: 16, fontWeight: '600', color: colors.textOnPrimary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowIcon: { marginRight: 14, padding: 8, borderRadius: 10 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
