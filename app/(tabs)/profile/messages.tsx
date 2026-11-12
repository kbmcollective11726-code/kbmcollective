import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { MessageCircle, PlusCircle, Users } from 'lucide-react-native';
import { format, isToday, isYesterday } from 'date-fns';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { useRolePreviewContext } from '../../../hooks/useRolePreviewContext';
import { supabase, withRetryAndRefresh, refreshSessionIfNeeded, getErrorMessage } from '../../../lib/supabase';
import { registerRefetchOnSessionRefreshed } from '../../../lib/onSessionRefreshed';
import { colors } from '../../../constants/colors';
import { themeColorWithAlpha, useEventThemeColor } from '../../../lib/eventTheme';
import {
  chatHref,
  navigateBackToFrom,
} from '../../../lib/navReturn';
import { fetchUnreadDmCountsBySender } from '../../../lib/unreadDmMessages';
import Avatar from '../../../components/Avatar';
import ProfileStackScreenHeader from '../../../components/ProfileStackScreenHeader';

type DmThread = {
  otherUserId: string;
  fullName: string;
  avatarUrl: string | null;
  lastPreview: string;
  lastAt: string;
  unreadCount: number;
};

type ChatGroup = {
  id: string;
  name: string;
  member_count?: number;
};

type HubRow =
  | { kind: 'dm'; thread: DmThread }
  | { kind: 'group'; group: ChatGroup };

function previewFromMessage(content: string | null | undefined, hasAttachment: boolean): string {
  const trimmed = (content ?? '').trim();
  if (trimmed && trimmed !== ' ') return trimmed;
  if (hasAttachment) return 'Photo';
  return 'Message';
}

function formatThreadTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

export default function MessagesHubScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const isFocused = useIsFocused();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const { applyEventAdmin } = useRolePreviewContext();
  const themeColor = useEventThemeColor();
  const themeFaded = themeColorWithAlpha(themeColor, '18');

  const [threads, setThreads] = useState<DmThread[]>([]);
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchErrorDetail, setFetchErrorDetail] = useState<string | null>(null);
  const fetchInProgressRef = useRef(false);

  const hubReturnPath = useMemo(() => {
    const raw = typeof from === 'string' ? from : from?.[0];
    if (raw?.trim()) {
      return `/(tabs)/profile/messages?from=${encodeURIComponent(raw.trim())}`;
    }
    return '/(tabs)/profile/messages';
  }, [from]);

  const goBack = useCallback(() => {
    navigateBackToFrom(router, from, '/(tabs)/home');
  }, [router, from]);

  const fetchAdmin = useCallback(async (): Promise<boolean> => {
    if (!user?.id || !currentEvent?.id) {
      setIsEventAdmin(false);
      return false;
    }
    const { data } = await supabase
      .from('event_members')
      .select('role, roles')
      .eq('event_id', currentEvent.id)
      .eq('user_id', user.id)
      .maybeSingle();
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

  const loadHub = useCallback(async () => {
    if (!user?.id || !currentEvent?.id) {
      setThreads([]);
      setGroups([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    if (fetchInProgressRef.current) return;
    fetchInProgressRef.current = true;
    setFetchError(null);
    setFetchErrorDetail(null);
    try {
      await withRetryAndRefresh(async () => {
        const myId = user.id;
        const eventId = currentEvent.id;

        const [messagesRes, groupsRes, memberRowsRes, unreadBySender] = await Promise.all([
          supabase
            .from('messages')
            .select('id, sender_id, receiver_id, content, attachment_url, created_at')
            .eq('event_id', eventId)
            .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
            .order('created_at', { ascending: false })
            .limit(200),
          supabase
            .from('chat_groups')
            .select('id, name, created_by, created_at')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false }),
          supabase.from('chat_group_members').select('group_id, user_id').eq('user_id', myId),
          fetchUnreadDmCountsBySender(eventId, myId),
        ]);

        if (messagesRes.error) throw messagesRes.error;
        if (groupsRes.error) throw groupsRes.error;

        const latestByOther = new Map<string, DmThread>();
        for (const row of messagesRes.data ?? []) {
          const senderId = row.sender_id as string;
          const receiverId = row.receiver_id as string;
          const otherId = senderId === myId ? receiverId : senderId;
          if (!otherId || latestByOther.has(otherId)) continue;
          latestByOther.set(otherId, {
            otherUserId: otherId,
            fullName: 'Member',
            avatarUrl: null,
            lastPreview: previewFromMessage(row.content as string | null, !!row.attachment_url),
            lastAt: row.created_at as string,
            unreadCount: unreadBySender.get(otherId) ?? 0,
          });
        }

        const otherIds = [...latestByOther.keys()];
        if (otherIds.length > 0) {
          const { data: users, error: usersErr } = await supabase
            .from('users')
            .select('id, full_name, avatar_url')
            .in('id', otherIds);
          if (usersErr) throw usersErr;
          for (const u of users ?? []) {
            const t = latestByOther.get(u.id as string);
            if (!t) continue;
            t.fullName = ((u.full_name as string) || 'Member').trim() || 'Member';
            t.avatarUrl = (u.avatar_url as string | null) ?? null;
          }
        }

        const memberGroupIds = new Set(
          (memberRowsRes.data ?? []).map((r) => r.group_id as string).filter(Boolean)
        );
        const isAdmin = await fetchAdmin();
        const allGroups = (groupsRes.data ?? []) as { id: string; name: string; created_by: string }[];
        const visibleGroups = allGroups.filter(
          (g) => isAdmin || memberGroupIds.has(g.id) || g.created_by === myId
        );

        const counts = await Promise.all(
          visibleGroups.map(async (g) => {
            const { count } = await supabase
              .from('chat_group_members')
              .select('*', { count: 'exact', head: true })
              .eq('group_id', g.id);
            return { id: g.id, count: count ?? 0 };
          })
        );
        const countMap = new Map(counts.map((c) => [c.id, c.count]));

        setThreads(
          [...latestByOther.values()].sort((a, b) => {
            if (a.unreadCount > 0 !== b.unreadCount > 0) return b.unreadCount > 0 ? 1 : -1;
            return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
          })
        );
        setGroups(
          visibleGroups.map((g) => ({
            id: g.id,
            name: g.name,
            member_count: countMap.get(g.id) ?? 0,
          }))
        );
      });
    } catch (e: unknown) {
      setThreads([]);
      setGroups([]);
      setFetchError('Error - page not loading');
      setFetchErrorDetail(getErrorMessage(e));
    } finally {
      fetchInProgressRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, currentEvent?.id, fetchAdmin]);

  useFocusEffect(
    useCallback(() => {
      if (!isFocused) return;
      setLoading(true);
      void loadHub();
    }, [isFocused, loadHub])
  );

  useEffect(() => {
    return registerRefetchOnSessionRefreshed(() => {
      if (isFocused) void loadHub();
    });
  }, [isFocused, loadHub]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSessionIfNeeded();
    } catch {
      /* ignore */
    }
    await loadHub();
  };

  const sections = useMemo(() => {
    const out: { title: string; data: HubRow[] }[] = [];
    if (threads.length > 0) {
      out.push({
        title: 'Conversations',
        data: threads.map((thread) => ({ kind: 'dm' as const, thread })),
      });
    }
    if (groups.length > 0) {
      out.push({
        title: 'Groups',
        data: groups.map((group) => ({ kind: 'group' as const, group })),
      });
    }
    return out;
  }, [threads, groups]);

  const openDm = (otherUserId: string) => {
    router.push(chatHref(otherUserId, hubReturnPath) as never);
  };

  const openGroup = (groupId: string) => {
    router.push(
      `/(tabs)/profile/groups/${groupId}?from=${encodeURIComponent(hubReturnPath)}` as never
    );
  };

  if (!currentEvent?.id || !user?.id) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Chat" onBack={goBack} />
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Select an event to see your chats.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && threads.length === 0 && groups.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Chat" onBack={goBack} />
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={themeColor} />
          <Text style={styles.placeholderText}>Loading chats…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader variant="back" title="Chat" onBack={goBack} />
      {fetchError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>Error - page not loading</Text>
          {fetchErrorDetail ? (
            <Text style={[styles.errorHint, { fontStyle: 'italic' }]} numberOfLines={2}>
              {fetchErrorDetail}
            </Text>
          ) : null}
          <TouchableOpacity
            onPress={() => {
              setLoading(true);
              void loadHub();
            }}
            style={[styles.createBtn, { backgroundColor: themeColor, marginTop: 12 }]}
          >
            <Text style={styles.createBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {effectiveIsEventAdmin ? (
        <TouchableOpacity
          style={[styles.createBtn, { backgroundColor: themeColor }]}
          onPress={() =>
            router.push(
              `/(tabs)/profile/groups/new?from=${encodeURIComponent(hubReturnPath)}` as never
            )
          }
          activeOpacity={0.8}
        >
          <PlusCircle size={22} color={colors.textOnPrimary} />
          <Text style={styles.createBtnText}>Create group</Text>
        </TouchableOpacity>
      ) : null}
      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        keyExtractor={(item) =>
          item.kind === 'dm' ? `dm-${item.thread.otherUserId}` : `g-${item.group.id}`
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColor} colors={[themeColor]} />
        }
        contentContainerStyle={[
          styles.list,
          sections.length === 0 && styles.listEmpty,
          { minHeight: Dimensions.get('window').height + 2 },
        ]}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { color: themeColor }]}>{section.title}</Text>
        )}
        ListEmptyComponent={
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No conversations yet.</Text>
            <Text style={styles.emptyHint}>Message someone from Community, or join a group when you’re added.</Text>
          </View>
        }
        renderItem={({ item }) => {
          if (item.kind === 'dm') {
            const t = item.thread;
            const hasUnread = t.unreadCount > 0;
            return (
              <TouchableOpacity
                style={[
                  styles.row,
                  { borderLeftColor: themeColor, borderLeftWidth: 3 },
                  hasUnread && { backgroundColor: themeFaded, borderColor: themeColor },
                ]}
                onPress={() => openDm(t.otherUserId)}
                activeOpacity={0.7}
              >
                <Avatar uri={t.avatarUrl} name={t.fullName} size={48} />
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text
                      style={[styles.rowTitle, hasUnread && styles.rowTitleUnread]}
                      numberOfLines={1}
                    >
                      {t.fullName}
                    </Text>
                    <Text style={[styles.rowTime, hasUnread && { color: themeColor, fontWeight: '700' }]}>
                      {formatThreadTime(t.lastAt)}
                    </Text>
                  </View>
                  <Text
                    style={[styles.rowMeta, hasUnread && styles.rowMetaUnread]}
                    numberOfLines={1}
                  >
                    {t.lastPreview}
                  </Text>
                </View>
                {hasUnread ? (
                  <View style={[styles.unreadBadge, { backgroundColor: themeColor }]}>
                    <Text style={styles.unreadBadgeText}>
                      {t.unreadCount > 99 ? '99+' : t.unreadCount}
                    </Text>
                  </View>
                ) : (
                  <MessageCircle size={18} color={colors.textMuted} />
                )}
              </TouchableOpacity>
            );
          }
          const g = item.group;
          return (
            <TouchableOpacity
              style={[styles.row, { borderLeftColor: themeColor, borderLeftWidth: 3 }]}
              onPress={() => openGroup(g.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.rowIcon, { backgroundColor: themeFaded }]}>
                <Users size={24} color={themeColor} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {g.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {g.member_count ?? 0} member{(g.member_count ?? 0) !== 1 ? 's' : ''}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  listEmpty: { flexGrow: 1 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  placeholder: { paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center' },
  placeholderText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', fontWeight: '600' },
  emptyHint: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  errorBanner: { padding: 16, alignItems: 'center' },
  errorText: { fontSize: 15, fontWeight: '600', color: colors.danger },
  errorHint: { fontSize: 13, color: colors.textMuted, marginTop: 6, textAlign: 'center' },
  createBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  createBtnText: { fontSize: 16, fontWeight: '600', color: colors.textOnPrimary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 10,
  },
  rowIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  rowTitleUnread: { fontWeight: '700' },
  rowTime: { fontSize: 12, color: colors.textMuted },
  rowMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  rowMetaUnread: { color: colors.text, fontWeight: '600' },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: colors.textOnPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
});
