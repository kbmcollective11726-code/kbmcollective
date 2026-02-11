import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MessageCircle, UserPlus, Search, Users, Mic, Store, Check, X } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useEventStore } from '../../stores/eventStore';
import { supabase } from '../../lib/supabase';
import { awardPoints } from '../../lib/points';
import { colors } from '../../constants/colors';
import Avatar from '../../components/Avatar';

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
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const fetchMembers = async () => {
    if (!currentEvent?.id || !user?.id) {
      setMembers([]);
      setLoading(false);
      return;
    }
    try {
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

      const connectedIds = new Set(
        (connectionsRes.data ?? []).map((r: { connected_user_id: string }) => r.connected_user_id)
      );
      const requestSentToIds = new Set(
        (requestsSentRes.data ?? []).map((r: { requested_user_id: string }) => r.requested_user_id)
      );
      const requestReceivedFromIds = new Set(
        (requestsReceivedRes.data ?? []).map((r: { requester_id: string }) => r.requester_id)
      );

      type Row = {
        user_id: string;
        role: string;
        roles?: string[] | null;
        users: { full_name: string; avatar_url: string | null; title: string | null; company: string | null } | null;
      };
      const rows = (membersRes.data ?? []) as unknown as Row[];
      const list: CommunityMember[] = rows
        .filter((r) => r.user_id !== user.id)
        .map((r) => ({
          user_id: r.user_id,
          full_name: r.users?.full_name ?? 'Unknown',
          avatar_url: r.users?.avatar_url ?? null,
          title: r.users?.title ?? null,
          company: r.users?.company ?? null,
          role: r.role,
          roles: (r.roles && r.roles.length > 0 ? r.roles : (r.role ? [r.role] : [])).filter(
            (x) => x !== 'super_admin'
          ),
          is_connected: connectedIds.has(r.user_id),
          request_sent_by_me: requestSentToIds.has(r.user_id),
          request_received_from_them: requestReceivedFromIds.has(r.user_id),
        }));

      setMembers(list);
    } catch (err) {
      console.error('Community fetch error:', err);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [currentEvent?.id, user?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMembers();
    setRefreshing(false);
  };

  const filteredMembers = useMemo(() => {
    let list = members;
    if (roleFilter !== 'all') {
      list = list.filter((m) => (m.roles?.length ? m.roles.includes(roleFilter) : m.role === roleFilter));
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
      const { error } = await supabase.from('connection_requests').insert({
        event_id: currentEvent.id,
        requester_id: user.id,
        requested_user_id: otherUserId,
        status: 'pending',
      });
      if (error) throw error;
      setMembers((prev) =>
        prev.map((p) =>
          p.user_id === otherUserId ? { ...p, request_sent_by_me: true } : p
        )
      );
    } catch (err) {
      console.error('Connect error:', err);
    } finally {
      setConnectingId(null);
    }
  };

  const handleAccept = async (otherUserId: string) => {
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
      if (!req) {
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
      setMembers((prev) =>
        prev.map((p) =>
          p.user_id === otherUserId
            ? { ...p, is_connected: true, request_received_from_them: false }
            : p
        )
      );
    } catch (err) {
      console.error('Accept error:', err);
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDecline = async (otherUserId: string) => {
    if (!user?.id || !currentEvent?.id) return;
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
        await supabase
          .from('connection_requests')
          .update({ status: 'declined' })
          .eq('id', (req as { id: string }).id);
      }
      setMembers((prev) =>
        prev.map((p) =>
          p.user_id === otherUserId ? { ...p, request_received_from_them: false } : p
        )
      );
    } catch (err) {
      console.error('Decline error:', err);
    }
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.subtitle}>Loading community…</Text>
        </View>
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
});
