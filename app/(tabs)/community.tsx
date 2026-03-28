import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { MessageCircle, UserPlus, UserMinus, Search, Users, Mic, Store, Check, X } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../../stores/authStore';
import { useEventStore } from '../../stores/eventStore';
import { supabase, withRetryAndRefresh } from '../../lib/supabase';
import { withRefreshTimeout } from '../../lib/refreshWithTimeout';
import { registerRefetchOnSessionRefreshed } from '../../lib/onSessionRefreshed';
import { awardPoints } from '../../lib/points';
import { createNotificationAndPush } from '../../lib/notifications';
import { colors } from '../../constants/colors';
import Avatar from '../../components/Avatar';

// Module-level, SCOPED BY EVENT: avoids stale "Request sent" / "Accept" from a previous event when switching events
const recentlySentByEvent: Record<string, Set<string>> = {}; // eventId -> Set of userIds
const recentlySentAtByEvent: Record<string, number> = {}; // "eventId:userId" -> timestamp
const recentlyReceivedByEvent: Record<string, Set<string>> = {};
const recentlyReceivedAtByEvent: Record<string, number> = {};

type CommunityMember = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  title: string | null;
  company: string | null;
  role: string;
  roles?: string[];
  is_connected: boolean;
  request_sent_by_me: boolean;
  request_received_from_them: boolean;
};

export default function CommunityScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const optimisticRequestSent = useRef(new Set<string>());
  const lastSentAt = useRef<Record<string, number>>({});

  const fetchInProgressRef = useRef(false);
  const fetchMembersRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const fetchMembers = async () => {
    if (!currentEvent?.id || !user?.id) {
      setMembers([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    if (fetchInProgressRef.current) return;
    fetchInProgressRef.current = true;
    setFetchError(null);
    try {
      await withRetryAndRefresh(async () => {
      const [membersRes, connectionsRes, requestsSentRes, requestsReceivedRes] = await Promise.all([
        supabase
          .from('event_members')
          .select('user_id, role, roles, users!inner(full_name, avatar_url, title, company)')
          .eq('event_id', currentEvent.id)
          .neq('role', 'super_admin')
          .order('joined_at', { ascending: false }),
        supabase
          .from('connections')
          .select('connected_user_id')
          .eq('event_id', currentEvent.id)
          .eq('user_id', user.id),
        supabase
          .from('connection_requests')
          .select('requested_user_id')
          .eq('event_id', currentEvent.id)
          .eq('requester_id', user.id)
          .eq('status', 'pending'),
        supabase
          .from('connection_requests')
          .select('requester_id')
          .eq('event_id', currentEvent.id)
          .eq('requested_user_id', user.id)
          .eq('status', 'pending'),
      ]);

      if (membersRes.error) throw membersRes.error;
      if (connectionsRes.error) throw connectionsRes.error;
      if (requestsSentRes.error) console.warn('Community: failed to fetch sent requests', requestsSentRes.error);
      if (requestsReceivedRes.error)
        console.warn('Community: failed to fetch received requests', requestsReceivedRes.error?.message, requestsReceivedRes.error);

      const connectedIds = new Set(
        (connectionsRes.data ?? []).map((r: { connected_user_id: string }) => r.connected_user_id)
      );
      const requestSentToIds = new Set(
        (requestsSentRes.data ?? []).map((r: { requested_user_id: string }) => r.requested_user_id)
      );
      const now = Date.now();
      const evId = currentEvent.id;
      // DB confirmed: clear from optimistic + module-level (event-scoped)
      requestSentToIds.forEach((id) => {
        optimisticRequestSent.current.delete(id);
        lastSentAt.current[id] = 0;
        recentlySentByEvent[evId]?.delete(id);
        delete recentlySentAtByEvent[`${evId}:${id}`];
      });
      optimisticRequestSent.current.forEach((id) => {
        if (now - (lastSentAt.current[id] ?? 0) > 60000) optimisticRequestSent.current.delete(id);
      });
      // Event-scoped sender expiry (5 min)
      Object.keys(recentlySentAtByEvent).forEach((key) => {
        if (now - (recentlySentAtByEvent[key] ?? 0) > 300000) {
          const [eid, uid] = key.split(':');
          if (eid && uid) recentlySentByEvent[eid]?.delete(uid);
          delete recentlySentAtByEvent[key];
        }
      });
      const requestReceivedFromIds = new Set(
        (requestsReceivedRes.data ?? []).map((r: { requester_id: string }) => r.requester_id)
      );
      // DB confirmed: clear optimistic recipient state (event-scoped)
      requestReceivedFromIds.forEach((id) => {
        recentlyReceivedByEvent[evId]?.delete(id);
        delete recentlyReceivedAtByEvent[`${evId}:${id}`];
      });
      // Event-scoped recipient expiry (5 min)
      Object.keys(recentlyReceivedAtByEvent).forEach((key) => {
        if (now - (recentlyReceivedAtByEvent[key] ?? 0) > 300000) {
          const [eid, uid] = key.split(':');
          if (eid && uid) recentlyReceivedByEvent[eid]?.delete(uid);
          delete recentlyReceivedAtByEvent[key];
        }
      });

      type Row = {
        user_id: string;
        role: string;
        roles?: string[] | null;
        users: { full_name: string; avatar_url: string | null; title: string | null; company: string | null } | null;
      };
      const rows = (membersRes.data ?? []) as unknown as Row[];
      const list: CommunityMember[] = rows
        .filter((r) => r.user_id !== user.id)
        .map((r) => {
          const roleList = (r.roles ?? []) as string[];
          const primary = r.role ?? '';
          const effectiveRoles = [...new Set([primary, ...roleList].filter(Boolean))].filter(
            (x) => x !== 'super_admin'
          );
          return {
            user_id: r.user_id,
            full_name: r.users?.full_name ?? 'Unknown',
            avatar_url: r.users?.avatar_url ?? null,
            title: r.users?.title ?? null,
            company: r.users?.company ?? null,
            role: primary,
            roles: effectiveRoles,
            is_connected: connectedIds.has(r.user_id),
            request_sent_by_me:
              requestSentToIds.has(r.user_id) ||
              optimisticRequestSent.current.has(r.user_id) ||
              (recentlySentByEvent[evId]?.has(r.user_id) ?? false),
            request_received_from_them:
              requestReceivedFromIds.has(r.user_id) ||
              (recentlyReceivedByEvent[evId]?.has(r.user_id) ?? false),
          };
        });

      setMembers(list);
      });
      setFetchError(null);
    } catch (err) {
      if (__DEV__) console.warn('Community fetch error:', err);
      setMembers([]);
      setFetchError('Error - page not loading');
    } finally {
      fetchInProgressRef.current = false;
      setLoading(false);
    }
  };
  fetchMembersRef.current = fetchMembers;

  const LOAD_TIMEOUT_MS = 45000; // pull-to-refresh only

  // Like Info: run and wait. No timer so first try can complete.
  useEffect(() => {
    if (!currentEvent?.id || !user?.id) {
      setMembers([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    let cancelled = false;
    fetchMembers()
      .catch(() => { if (!cancelled) setTimeout(() => fetchMembers().finally(() => {}), 2000); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentEvent?.id, user?.id]);

  // Clear optimistic refs when switching events so we don't show stale "Request sent" from previous event
  useEffect(() => {
    optimisticRequestSent.current.clear();
    lastSentAt.current = {};
  }, [currentEvent?.id]);

  useFocusEffect(
    useCallback(() => {
      fetchInProgressRef.current = false;
      if (currentEvent?.id && user?.id) fetchMembers().catch(() => {});
    }, [currentEvent?.id, user?.id])
  );

  // Refetch when root layout refreshes session after app resume (notifyAfterSessionRefreshed).
  useEffect(() => {
    const unregister = registerRefetchOnSessionRefreshed(() => {
      fetchInProgressRef.current = false;
      fetchMembersRef.current().catch(() => {});
    });
    return unregister;
  }, []);

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

  // When someone sends me a connection request, refetch so I see Accept/Decline without pulling to refresh
  // When someone accepts/declines my request, refetch so I see Connected or Request sent
  useEffect(() => {
    if (!currentEvent?.id || !user?.id) return;
    const evId = currentEvent.id;
    const uid = user.id;
    const channel = supabase
      .channel('community-connection-requests')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'connection_requests',
          filter: `requested_user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = (payload as { new?: { event_id?: string; requester_id?: string; requested_user_id?: string } })
            ?.new;
          if (
            row?.requester_id &&
            row?.requested_user_id === uid &&
            row?.event_id === evId
          ) {
            if (!recentlyReceivedByEvent[evId]) recentlyReceivedByEvent[evId] = new Set();
            recentlyReceivedByEvent[evId].add(row.requester_id);
            recentlyReceivedAtByEvent[`${evId}:${row.requester_id}`] = Date.now();
          }
          fetchMembers().catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'connection_requests',
          filter: `requester_id=eq.${user.id}`,
        },
        () => { fetchMembers().catch(() => {}); }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'connections',
          filter: `user_id=eq.${user.id}`,
        },
        () => { fetchMembers().catch(() => {}); }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent?.id, user?.id]);

  // Polling fallback: refetch every 15s so recipient sees new requests without hammering the API
  useEffect(() => {
    if (!currentEvent?.id || !user?.id) return;
    const interval = setInterval(() => { fetchMembers().catch(() => {}); }, 15000);
    return () => clearInterval(interval);
  }, [currentEvent?.id, user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    setFetchError(null);
    try {
      await withRefreshTimeout(fetchMembers(), LOAD_TIMEOUT_MS);
    } catch {
      setFetchError('Request timed out. Pull down to retry.');
    } finally {
      setRefreshing(false);
    }
  };

  const filteredMembers = useMemo(() => {
    let list = members;
    if (roleFilter !== 'all') {
      list = list.filter((m) => {
        const roles = m.roles ?? (m.role ? [m.role] : []);
        return roles.includes(roleFilter);
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.full_name?.toLowerCase().includes(q) ||
          m.title?.toLowerCase().includes(q) ||
          m.company?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [members, roleFilter, searchQuery]);

  const handleConnect = async (otherUserId: string) => {
    if (!user?.id || !currentEvent?.id) return;
    setConnectingId(otherUserId);
    try {
      const { data, error } = await supabase
        .from('connection_requests')
        .insert({
          event_id: currentEvent.id,
          requester_id: user.id,
          requested_user_id: otherUserId,
          status: 'pending',
        })
        .select('id')
        .single();
      if (error) {
        if (error.code === '23505') {
          optimisticRequestSent.current.add(otherUserId);
          if (!recentlySentByEvent[currentEvent.id]) recentlySentByEvent[currentEvent.id] = new Set();
          recentlySentByEvent[currentEvent.id].add(otherUserId);
          recentlySentAtByEvent[`${currentEvent.id}:${otherUserId}`] = Date.now();
          Toast.show({ type: 'info', text1: 'Request already sent', text2: "You've already sent a connection request to this person." });
          setMembers((prev) =>
            prev.map((p) =>
              p.user_id === otherUserId ? { ...p, request_sent_by_me: true } : p
            )
          );
          return;
        }
        console.error('Community connect insert error:', error.code, error.message);
        throw error;
      }
      if (!data) {
        console.warn('Community connect: insert returned no row');
      }
      optimisticRequestSent.current.add(otherUserId);
      lastSentAt.current[otherUserId] = Date.now();
      if (!recentlySentByEvent[currentEvent.id]) recentlySentByEvent[currentEvent.id] = new Set();
      recentlySentByEvent[currentEvent.id].add(otherUserId);
      recentlySentAtByEvent[`${currentEvent.id}:${otherUserId}`] = Date.now();
      setMembers((prev) =>
        prev.map((p) =>
          p.user_id === otherUserId ? { ...p, request_sent_by_me: true } : p
        )
      );
      await createNotificationAndPush(
        otherUserId,
        currentEvent.id,
        'connection_request',
        'Connection request',
        `${user.full_name ?? 'Someone'} wants to connect with you`,
        { requester_id: user.id }
      );
      Toast.show({ type: 'success', text1: 'Request sent', text2: 'They\'ll see it in Community and can accept to connect.' });
    } catch (err) {
      console.error('Connect error:', err);
      Toast.show({ type: 'error', text1: 'Could not send request', text2: 'Please try again.' });
    } finally {
      setConnectingId(null);
    }
  };

  const handleAccept = async (otherUserId: string) => {
    if (!user?.id || !currentEvent?.id) return;
    setAcceptingId(otherUserId);
    try {
      const { data: req, error: selectErr } = await supabase
        .from('connection_requests')
        .select('id')
        .eq('event_id', currentEvent.id)
        .eq('requester_id', otherUserId)
        .eq('requested_user_id', user.id)
        .eq('status', 'pending')
        .single();
      if (selectErr && selectErr.code !== 'PGRST116') throw selectErr;
      if (!req) {
        Toast.show({ type: 'info', text1: 'Request not found', text2: 'It may have been accepted or declined already.' });
        setMembers((prev) =>
          prev.map((p) =>
            p.user_id === otherUserId ? { ...p, request_received_from_them: false } : p
          )
        );
        setAcceptingId(null);
        return;
      }
      const { error: updateErr } = await supabase
        .from('connection_requests')
        .update({ status: 'accepted' })
        .eq('id', (req as { id: string }).id);
      if (updateErr) throw updateErr;
      const { error: ins1 } = await supabase.from('connections').insert({
        event_id: currentEvent.id,
        user_id: user.id,
        connected_user_id: otherUserId,
      });
      if (ins1) throw ins1;
      const { error: ins2 } = await supabase.from('connections').insert({
        event_id: currentEvent.id,
        user_id: otherUserId,
        connected_user_id: user.id,
      });
      if (ins2) throw ins2;
      await awardPoints(user.id, currentEvent.id, 'connect');
      await createNotificationAndPush(
        otherUserId,
        currentEvent.id,
        'system',
        'Connection accepted',
        `${user.full_name ?? 'Someone'} accepted your connection request`,
        { chat_user_id: user.id }
      );
      setMembers((prev) =>
        prev.map((p) =>
          p.user_id === otherUserId
            ? { ...p, is_connected: true, request_received_from_them: false }
            : p
        )
      );
      Toast.show({ type: 'success', text1: 'Connected', text2: "You're now connected. You can message them." });
    } catch (err) {
      console.error('Accept error:', err);
      Toast.show({ type: 'error', text1: 'Could not accept', text2: 'Please try again.' });
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDecline = async (otherUserId: string) => {
    if (!user?.id || !currentEvent?.id) return;
    setAcceptingId(otherUserId);
    try {
      const { data: req } = await supabase
        .from('connection_requests')
        .select('id')
        .eq('event_id', currentEvent.id)
        .eq('requester_id', otherUserId)
        .eq('requested_user_id', user.id)
        .eq('status', 'pending')
        .single();
      if (req) {
        const { error: updateErr } = await supabase
          .from('connection_requests')
          .update({ status: 'declined' })
          .eq('id', (req as { id: string }).id);
        if (updateErr) throw updateErr;
      }
      setMembers((prev) =>
        prev.map((p) =>
          p.user_id === otherUserId ? { ...p, request_received_from_them: false } : p
        )
      );
      Toast.show({ type: 'success', text1: 'Declined', text2: 'Connection request declined.' });
    } catch (err) {
      console.error('Decline error:', err);
      Toast.show({ type: 'error', text1: 'Could not decline', text2: 'Please try again.' });
    } finally {
      setAcceptingId(null);
    }
  };

  const handleRemoveConnection = (otherUserId: string, fullName: string) => {
    Alert.alert(
      'Remove connection',
      `Remove ${fullName} from your connections? You can send a new request later if you change your mind.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!user?.id || !currentEvent?.id) return;
            setRemovingId(otherUserId);
            try {
              const { error: err1 } = await supabase
                .from('connections')
                .delete()
                .eq('event_id', currentEvent.id)
                .eq('user_id', user.id)
                .eq('connected_user_id', otherUserId);
              if (err1) throw err1;
              const { error: err2 } = await supabase
                .from('connections')
                .delete()
                .eq('event_id', currentEvent.id)
                .eq('user_id', otherUserId)
                .eq('connected_user_id', user.id);
              if (err2) throw err2;
              setMembers((prev) =>
                prev.map((p) => (p.user_id === otherUserId ? { ...p, is_connected: false } : p))
              );
              Toast.show({ type: 'success', text1: 'Connection removed' });
            } catch (err) {
              console.error('Remove connection error:', err);
              Toast.show({ type: 'error', text1: 'Could not remove', text2: 'Please try again.' });
            } finally {
              setRemovingId(null);
            }
          },
        },
      ]
    );
  };

  const handleMessage = (otherUserId: string) => {
    router.push(`/profile/chat/${otherUserId}?from=${encodeURIComponent('/(tabs)/community')}` as any);
  };

  const handleViewProfile = (otherUserId: string) => {
    router.push(`/feed/user/${otherUserId}?from=${encodeURIComponent('/(tabs)/community')}` as any);
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.title}>Community</Text>
          <Text style={styles.subtitle}>Select an event on the Info tab first.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show Community layout immediately so the tab "loads"; content is loading/error + retry.
  if (loading || fetchError) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <FlatList
          data={[]}
          renderItem={() => null}
          keyExtractor={() => 'empty'}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
          ListEmptyComponent={
            <View style={styles.placeholder}>
              {loading ? (
                <>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={styles.title}>Community</Text>
                  <Text style={styles.subtitle}>Loading community…</Text>
                </>
              ) : (
                <>
                  <Text style={styles.title}>Couldn't load community</Text>
                  <Text style={styles.subtitle}>{fetchError}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setFetchError(null);
                      setLoading(true);
                      fetchMembers();
                    }}
                    style={styles.retryBtn}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.retryBtnText}>Try again</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
        />
      </SafeAreaView>
    );
  }

  const renderItem = ({ item }: { item: CommunityMember }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => handleViewProfile(item.user_id)}
      activeOpacity={0.7}
    >
      <Avatar uri={item.avatar_url} name={item.full_name} size={48} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {item.full_name}
        </Text>
        {(item.title || item.company) ? (
          <Text style={styles.titleCompany} numberOfLines={1}>
            {[item.title, item.company].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {item.is_connected ? (
          <View style={styles.connectedActions}>
            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary]}
              onPress={(e) => {
                e.stopPropagation();
                handleMessage(item.user_id);
              }}
            >
              <MessageCircle size={18} color={colors.textOnPrimary} />
              <Text style={styles.buttonPrimaryText}>Message</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonRemove]}
              onPress={(e) => {
                e.stopPropagation();
                handleRemoveConnection(item.user_id, item.full_name ?? 'this person');
              }}
              disabled={removingId === item.user_id}
            >
              {removingId === item.user_id ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <>
                  <UserMinus size={16} color={colors.textMuted} />
                  <Text style={styles.buttonRemoveText}>Remove</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : item.request_received_from_them ? (
          <View style={styles.requestActions}>
            <TouchableOpacity
              style={[styles.button, styles.buttonAccept]}
              onPress={(e) => {
                e.stopPropagation();
                handleAccept(item.user_id);
              }}
              disabled={acceptingId === item.user_id}
            >
              {acceptingId === item.user_id ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Check size={16} color="#fff" />
                  <Text style={styles.buttonAcceptText}>Accept</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonDecline]}
              onPress={(e) => {
                e.stopPropagation();
                handleDecline(item.user_id);
              }}
              disabled={acceptingId === item.user_id}
            >
              <X size={16} color={colors.textSecondary} />
              <Text style={styles.buttonDeclineText}>Decline</Text>
            </TouchableOpacity>
          </View>
        ) : item.request_sent_by_me ? (
          <View style={[styles.button, styles.buttonMuted]}>
            <Text style={styles.buttonMutedText}>Request sent</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.button, styles.buttonSecondary]}
            onPress={(e) => {
              e.stopPropagation();
              handleConnect(item.user_id);
            }}
            disabled={connectingId === item.user_id}
          >
            {connectingId === item.user_id ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <UserPlus size={18} color={colors.primary} />
                <Text style={styles.buttonSecondaryText}>Connect</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.eventHeader}>
        <Text style={styles.eventHeaderText} numberOfLines={1}>
          {currentEvent?.name ?? 'Community'}
        </Text>
        <Text style={styles.eventHeaderHint}>
          Both users must have this event selected to see connection requests
        </Text>
      </View>
      <View style={styles.searchBar}>
        <Search size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by name..."
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <View style={styles.filterRow}>
        {[
          { key: 'all', label: 'All', icon: Users },
          { key: 'attendee', label: 'Attendees', icon: Users },
          { key: 'speaker', label: 'Speakers', icon: Mic },
          { key: 'vendor', label: 'Vendors', icon: Store },
        ].map(({ key, label, icon: Icon }) => (
          <TouchableOpacity
            key={key}
            style={[styles.filterChip, roleFilter === key && styles.filterChipActive]}
            onPress={() => setRoleFilter(key)}
          >
            <Icon size={12} color={roleFilter === key ? '#fff' : colors.textMuted} />
            <Text style={[styles.filterChipText, roleFilter === key && styles.filterChipTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredMembers}
        keyExtractor={(item) => item.user_id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={5}
        ListEmptyComponent={
          <View style={styles.placeholder}>
            <Text style={styles.subtitle}>
              {members.length === 0
                ? 'No community members yet.'
                : 'No results match your search.'}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  eventHeader: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  eventHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  eventHeaderHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    padding: 0,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 6,
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: '#fff',
  },
  list: {
    padding: 16,
    paddingBottom: 100,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  retryBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  retryBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  titleCompany: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  roleBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  roleSpeaker: {
    backgroundColor: colors.primary + '30',
  },
  roleVendor: {
    backgroundColor: colors.secondary + '30',
  },
  roleText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  actions: {
    marginLeft: 8,
  },
  connectedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonPrimaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  buttonSecondary: {
    backgroundColor: colors.primaryFaded,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  buttonSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  requestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  buttonAccept: {
    backgroundColor: colors.secondary,
  },
  buttonAcceptText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  buttonDecline: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonDeclineText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  buttonMuted: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonMutedText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  buttonRemove: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonRemoveText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
