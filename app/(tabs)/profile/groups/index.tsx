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
  AppState,
  AppStateStatus,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Users, PlusCircle } from 'lucide-react-native';
import { useAuthStore } from '../../../../stores/authStore';
import { useEventStore } from '../../../../stores/eventStore';
import { supabase, withRetryAndRefresh, refreshSessionIfNeeded, getErrorMessage } from '../../../../lib/supabase';
import { addDebugLog } from '../../../../lib/debugLog';
import { colors } from '../../../../constants/colors';
import Avatar from '../../../../components/Avatar';

type ChatGroup = {
  id: string;
  event_id: string;
  name: string;
  created_by: string;
  created_at: string;
  member_count?: number;
};

const RESUME_REFETCH_DEBOUNCE_MS = 12000;

export default function GroupsListScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const lastResumeRefetchAt = useRef<number>(0);
  const [groups, setGroups] = useState<ChatGroup[]>([]);

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
      .single();
    if (__DEV__) console.log('[Groups] Supabase event_members (fetchAdmin) — data:', data, 'error:', error);
    const row = data as { role?: string; roles?: string[] } | null;
    const role = row?.role ?? 'attendee';
    const roles = Array.isArray(row?.roles) ? row.roles : [];
    const admin =
      role === 'admin' ||
      role === 'super_admin' ||
      roles.includes('admin') ||
      roles.includes('super_admin') ||
      user?.is_platform_admin === true;
    setIsEventAdmin(admin);
    return admin;
  }, [user?.id, user?.is_platform_admin, currentEvent?.id]);

  const fetchInProgressRef = useRef(false);
  const autoRetryScheduledRef = useRef(false);
  const mountedRef = useRef(false);
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
      autoRetryScheduledRef.current = false;
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

  useEffect(() => {
    if (!user?.id || !currentEvent?.id) {
      setGroups([]);
      setLoading(false);
      return;
    }
    if (mountedRef.current) return;
    mountedRef.current = true;
    setFetchError(null);
    setLoading(true);
    fetchAdmin()
      .then((admin) => fetchGroups(admin))
      .finally(() => setLoading(false));
  }, [user?.id, currentEvent?.id, fetchAdmin, fetchGroups]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id && currentEvent?.id) {
        fetchInProgressRef.current = false;
        fetchAdmin().then((admin) => fetchGroups(admin)).catch(() => {});
      }
    }, [user?.id, currentEvent?.id, fetchAdmin, fetchGroups])
  );

  // When app comes back from background: wait for root’s refresh, then load.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active' || !user?.id || !currentEvent?.id) return;
      const now = Date.now();
      if (now - lastResumeRefetchAt.current < RESUME_REFETCH_DEBOUNCE_MS) return;
      lastResumeRefetchAt.current = now;
      fetchInProgressRef.current = false;
      refreshSessionIfNeeded()
        .catch(() => {})
        .finally(() => fetchAdmin().then((admin) => fetchGroups(admin)).catch(() => {}));
    });
    return () => sub.remove();
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
        fetchInProgressRef.current = false;
        setLoading(false);
        setFetchError('Error - page not loading');
        setFetchErrorDetail('Timed out');
        if (!autoRetryScheduledRef.current && user?.id && currentEvent?.id) {
          autoRetryScheduledRef.current = true;
          setTimeout(() => fetchAdmin().then((admin) => fetchGroups(admin)).catch(() => {}), 2000);
        }
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
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Select an event to see your groups.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && groups.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.placeholderText}>Loading groups…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
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
            style={[styles.createBtn, { marginTop: 12, alignSelf: 'center' }]}
            activeOpacity={0.8}
          >
            <Text style={styles.createBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {isEventAdmin && (
        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => router.push('/(tabs)/profile/groups/new')}
          activeOpacity={0.8}
        >
          <PlusCircle size={22} color={colors.textOnPrimary} />
          <Text style={styles.createBtnText}>Create group</Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={groups}
        keyExtractor={(item) => item.id}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={5}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        contentContainerStyle={[styles.list, groups.length === 0 && styles.listEmpty, { minHeight: Dimensions.get('window').height + 2 }]}
        ListEmptyComponent={
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>
              {isEventAdmin ? 'No groups yet. Create one to get started.' : 'You’re not in any groups yet.'}
            </Text>
            {!fetchError && currentEvent?.name ? (
              <>
                <Text style={styles.emptyHint}>
                  Groups are listed per event. If you created groups under a different event, switch to that event on Home, then open Groups again.
                </Text>
                <TouchableOpacity
                  style={styles.switchEventBtn}
                  onPress={() => router.push('/(tabs)/home')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.switchEventBtnText}>Go to Home → switch event</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push(`/(tabs)/profile/groups/${item.id}` as any)}
            activeOpacity={0.7}
          >
            <View style={styles.rowIcon}>
              <Users size={24} color={colors.primary} />
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
      {isEventAdmin && (
        <TouchableOpacity
          style={styles.manageLink}
          onPress={() => router.push('/(tabs)/profile/admin')}
          activeOpacity={0.7}
        >
          <Text style={styles.manageLinkText}>Event admin → manage event & members</Text>
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
  rowIcon: { marginRight: 14 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
