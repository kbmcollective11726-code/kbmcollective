import { useEffect, useState, useLayoutEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import { Trophy, RefreshCw, X, User } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useEventStore } from '../../stores/eventStore';
import { supabase, withRetryAndRefresh, refreshSessionIfNeeded } from '../../lib/supabase';
import { withRefreshTimeout } from '../../lib/refreshWithTimeout';
import { colors } from '../../constants/colors';
import Avatar from '../../components/Avatar';
import HeaderNotificationBell from '../../components/HeaderNotificationBell';

type LeaderboardRow = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  points: number;
  rank: number;
};

type PointRule = { id?: string; action: string; points_value: number; max_per_day: number | null; description: string | null };

const ACTION_LABELS: Record<string, string> = {
  post_photo: 'Post a photo',
  give_like: "Like someone else's post",
  comment: "Comment on someone else's post",
  receive_like: 'Someone liked your post',
  receive_comment: 'Someone commented on your post',
  connect: 'Connect with another attendee',
  attend_session: 'Attend a session',
  complete_profile: 'Complete your profile',
  daily_streak: 'Daily streak',
  vendor_meeting: 'Visit a vendor booth',
  checkin: 'Check in at event',
  share_linkedin: 'Share on LinkedIn',
};

export default function LeaderboardScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showPointsModal, setShowPointsModal] = useState(false);
  const [pointRules, setPointRules] = useState<PointRule[]>([]);
  const [pointsModalLoading, setPointsModalLoading] = useState(false);

  const fetchLeaderboard = async () => {
    if (!currentEvent?.id || !user?.id) {
      setRows([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    setFetchError(null);
    try {
      await withRetryAndRefresh(async () => {
        const { data, error } = await supabase
          .from('event_members')
          .select('user_id, points, users!inner(full_name, avatar_url)')
          .eq('event_id', currentEvent.id)
          .order('points', { ascending: false });

        if (error) throw error;

        type SupabaseRow = {
          user_id: string;
          points: number;
          users: { full_name: string; avatar_url: string | null } | null;
        };
        const typed = (data ?? []) as unknown as SupabaseRow[];
        const list: LeaderboardRow[] = typed.map((r, i) => ({
          user_id: r.user_id,
          full_name: r.users?.full_name ?? 'Unknown',
          avatar_url: r.users?.avatar_url ?? null,
          points: Number(r.points) || 0,
          rank: i + 1,
        }));
        setRows(list);
      });
      setFetchError(null);
    } catch (err) {
      if (__DEV__) console.warn('Leaderboard fetch error:', err);
      setRows([]);
      setFetchError('Error - page not loading');
    } finally {
      setLoading(false);
    }
  };

  const LOAD_TIMEOUT_MS = 45000; // pull-to-refresh only

  // Like Info: run and wait. No timer so first try can complete.
  useEffect(() => {
    if (!currentEvent?.id || !user?.id) {
      setRows([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    let cancelled = false;
    fetchLeaderboard()
      .catch(() => { if (!cancelled) setTimeout(() => fetchLeaderboard().finally(() => {}), 2000); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentEvent?.id, user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (currentEvent?.id && user?.id) fetchLeaderboard().catch(() => {});
    }, [currentEvent?.id, user?.id])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && currentEvent?.id && user?.id) {
        refreshSessionIfNeeded()
          .catch(() => {})
          .finally(() => fetchLeaderboard().catch(() => {}));
      }
    });
    return () => sub.remove();
  }, [currentEvent?.id, user?.id]);

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
        setFetchError('Error - page not loading');
      }
    }, 40000);
    return () => clearTimeout(t);
  }, [loading]);

  const onRefresh = async () => {
    setRefreshing(true);
    setFetchError(null);
    try {
      await withRefreshTimeout(fetchLeaderboard(), LOAD_TIMEOUT_MS);
    } catch {
      setFetchError('Request timed out. Pull down to retry.');
    } finally {
      setRefreshing(false);
    }
  };

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  const second = top3[1];
  const first = top3[0];
  const third = top3[2];

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';

  const openPointsModal = useCallback(async () => {
    if (!currentEvent?.id) return;
    setShowPointsModal(true);
    setPointsModalLoading(true);
    setPointRules([]);
    try {
      const { data, error } = await supabase
        .from('point_rules')
        .select('id, action, points_value, max_per_day, description')
        .eq('event_id', currentEvent.id)
        .order('points_value', { ascending: false });
      if (error) throw error;
      const raw = (data ?? []) as (PointRule & { id?: string })[];
      // Dedupe by action: keep the row with highest points_value per action (first when already ordered desc)
      const byAction = new Map<string, PointRule & { id?: string }>();
      for (const rule of raw) {
        if (!byAction.has(rule.action)) byAction.set(rule.action, rule);
      }
      setPointRules(Array.from(byAction.values()));
    } catch (err) {
      console.error('Point rules fetch error:', err);
      setPointRules([]);
    } finally {
      setPointsModalLoading(false);
    }
  }, [currentEvent?.id]);

  // Close modal when event changes so we never show another event's rules
  useEffect(() => {
    setShowPointsModal(false);
  }, [currentEvent?.id]);

  const getActionLabel = (rule: PointRule) =>
    rule.description?.trim() || ACTION_LABELS[rule.action] || rule.action.replace(/_/g, ' ');

  const openUserProfile = (userId: string) => {
    router.push(`/feed/user/${userId}?from=${encodeURIComponent('/(tabs)/leaderboard')}` as any);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerRight}>
          <HeaderNotificationBell />
          <TouchableOpacity onPress={onRefresh} disabled={refreshing} style={styles.refreshBtn} hitSlop={12}>
            <RefreshCw size={22} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} style={styles.profileBtn} hitSlop={12}>
            <User size={24} color={colors.primary} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, refreshing, onRefresh, router]);

  const renderPodiumRow = (entry: LeaderboardRow | undefined, label: string, size: number) => {
    if (!entry) return <View style={[styles.podiumSlot, { width: size, height: size }]} />;
    const isMe = user?.id === entry.user_id;
    return (
      <TouchableOpacity
        style={[styles.podiumSlot, { width: size }]}
        onPress={() => openUserProfile(entry.user_id)}
        activeOpacity={0.7}
      >
        <View style={[styles.podiumAvatarWrap, { width: size, height: size, borderRadius: size / 2 }]}>
          {entry.avatar_url ? (
            <Avatar uri={entry.avatar_url} name={entry.full_name} size={size} />
          ) : (
            <View style={[styles.podiumInitials, { width: size, height: size, borderRadius: size / 2 }]}>
              <Text style={[styles.podiumInitialsText, { fontSize: size * 0.35 }]}>{getInitials(entry.full_name)}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.podiumName, label === '1st' && styles.podiumNameFirst]} numberOfLines={1}>{entry.full_name}</Text>
        <Text style={[styles.podiumPts, label === '1st' && styles.podiumPtsFirst, isMe && styles.podiumPtsMe]}>{entry.points} pts</Text>
        <Text style={[styles.podiumLabel, label === '1st' && styles.podiumLabelFirst]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  const renderRestItem = ({ item, index }: { item: LeaderboardRow; index: number }) => {
    const isMe = user?.id === item.user_id;
    const displayRank = index + 4;
    const isAlt = index % 2 === 1;
    return (
      <TouchableOpacity
        style={[styles.restRow, isAlt && styles.restRowAlt, isMe && styles.restRowMe]}
        onPress={() => openUserProfile(item.user_id)}
        activeOpacity={0.7}
      >
        <Text style={styles.restRank}>{displayRank}</Text>
        {item.avatar_url ? (
          <Avatar uri={item.avatar_url} name={item.full_name} size={44} />
        ) : (
          <View style={styles.restInitials}>
            <Text style={styles.restInitialsText}>{getInitials(item.full_name)}</Text>
          </View>
        )}
        <View style={styles.restNameCell}>
          <Text style={[styles.restName, isMe && styles.restNameMe]} numberOfLines={1}>{item.full_name}</Text>
          {isMe && <Text style={styles.youLabel}>You</Text>}
        </View>
        <Text style={[styles.restPts, isMe && styles.restPtsMe]}>{item.points} pts</Text>
      </TouchableOpacity>
    );
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.placeholder}>
          <Trophy size={48} color={colors.textMuted} />
          <Text style={styles.title}>Leaderboard</Text>
          <Text style={styles.subtitle}>Select an event on the Info tab first.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show Rank layout immediately so the tab "loads"; content is loading/error + retry.
  if (loading || fetchError) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
        >
          <View style={styles.placeholder}>
            <Trophy size={48} color={colors.textMuted} />
            {loading ? (
              <>
                <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: 12 }} />
                <Text style={styles.title}>Rank</Text>
                <Text style={styles.subtitle}>Loading leaderboard…</Text>
              </>
            ) : (
              <>
                <Text style={styles.title}>Error - page not loading</Text>
                <Text style={styles.subtitle}>Pull down to refresh or tap Try again.</Text>
                <Pressable
                  onPress={() => {
                    setFetchError(null);
                    setLoading(true);
                    fetchLeaderboard();
                  }}
                  style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.retryBtnText}>Try again</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {rows.length === 0 ? (
          <View style={styles.placeholder}>
            <Text style={styles.subtitle}>No members yet. Join the event and start earning points!</Text>
            <TouchableOpacity style={[styles.howToBtn, styles.howToBtnSmall, { marginTop: 20 }]} onPress={openPointsModal}>
              <Text style={[styles.howToBtnText, styles.howToBtnSmallText]}>How to earn points</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.podium}>
              {renderPodiumRow(second, '2nd', 66)}
              {renderPodiumRow(first, '1st', 84)}
              {renderPodiumRow(third, '3rd', 58)}
            </View>

            <View style={styles.howToWrap}>
              <TouchableOpacity style={[styles.howToBtn, styles.howToBtnSmall]} onPress={openPointsModal}>
                <Text style={[styles.howToBtnText, styles.howToBtnSmallText]}>How to earn points</Text>
              </TouchableOpacity>
            </View>
            {!user && (
              <Text style={styles.loginHint}>Log in to start earning points</Text>
            )}

            {rest.length > 0 && (
              <View style={styles.restSection}>
                <Text style={styles.restSectionTitle}>Rankings</Text>
                <View style={styles.restList}>
                  {rest.map((item, index) => (
                    <View key={item.user_id}>
                      {renderRestItem({ item, index })}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={showPointsModal} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowPointsModal(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>How to earn points</Text>
                {currentEvent?.name && (
                  <Text style={styles.modalSubtitle} numberOfLines={1}>{currentEvent.name}</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setShowPointsModal(false)} hitSlop={12}>
                <X size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {pointsModalLoading ? (
              <View style={styles.modalBody}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : pointRules.length === 0 ? (
              <View style={styles.modalBody}>
                <Text style={styles.modalEmpty}>No point rules set for this event yet.</Text>
              </View>
            ) : (
              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                {pointRules.map((rule) => (
                  <View key={rule.id ?? rule.action} style={styles.ruleRow}>
                    <Text style={styles.ruleLabel}>{getActionLabel(rule)}</Text>
                    <View style={styles.rulePointsWrap}>
                      <Text style={styles.rulePoints}>{rule.points_value} pts</Text>
                      {rule.max_per_day != null && (
                        <Text style={styles.ruleLimit}>max {rule.max_per_day}/day</Text>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setShowPointsModal(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: { fontSize: 20, fontWeight: '600', color: colors.text, marginTop: 12, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  refreshBtn: { padding: 8, marginRight: 8 },
  profileBtn: { padding: 4, marginRight: 8 },
  scrollContent: { paddingTop: 0, paddingBottom: 32 },
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 28,
    paddingTop: 4,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  podiumSlot: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  podiumAvatarWrap: { overflow: 'hidden' },
  podiumInitials: {
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  podiumInitialsText: { fontWeight: '700', color: colors.text },
  podiumName: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 8, maxWidth: 100 },
  podiumNameFirst: { fontSize: 14, maxWidth: 100 },
  podiumPts: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 2 },
  podiumPtsFirst: { fontSize: 15 },
  podiumPtsMe: { color: colors.primary },
  podiumLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  podiumLabelFirst: { fontSize: 11 },
  howToWrap: {
    alignItems: 'center',
    marginBottom: 6,
    marginTop: 0,
  },
  howToBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  howToBtnSmall: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  howToBtnText: { fontSize: 16, fontWeight: '600', color: colors.textOnPrimary },
  howToBtnSmallText: { fontSize: 14 },
  retryBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  retryBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  loginHint: { fontSize: 13, color: colors.primary, textAlign: 'center', marginBottom: 20 },
  restSection: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  restSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  restList: {},
  restRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  restRowAlt: { backgroundColor: colors.surfaceHover },
  restRowMe: { backgroundColor: colors.primaryFaded, borderColor: colors.primary },
  restRank: { width: 28, fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  restInitials: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  restInitialsText: { fontSize: 16, fontWeight: '700', color: colors.text },
  restNameCell: { flex: 1, marginLeft: 12, minWidth: 0 },
  restName: { fontSize: 16, color: colors.text },
  restNameMe: { fontWeight: '600' },
  youLabel: { fontSize: 12, color: colors.primary, marginTop: 2 },
  restPts: { fontSize: 16, fontWeight: '600', color: colors.text },
  restPtsMe: { color: colors.primary },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    backgroundColor: colors.background,
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  modalSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  modalBody: {
    padding: 20,
    maxHeight: 320,
  },
  modalEmpty: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  ruleLabel: { fontSize: 15, color: colors.text, flex: 1 },
  rulePointsWrap: { alignItems: 'flex-end' },
  rulePoints: { fontSize: 16, fontWeight: '700', color: colors.primary },
  ruleLimit: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  modalCloseBtn: {
    margin: 20,
    marginTop: 0,
    paddingVertical: 14,
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCloseBtnText: { fontSize: 16, fontWeight: '600', color: colors.textOnPrimary },
});
