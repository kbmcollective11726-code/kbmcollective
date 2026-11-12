import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from "@react-navigation/native";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Linking,
  Alert,
  BackHandler,
  Modal,
  TextInput,
} from 'react-native';
import Avatar from '../../../../components/Avatar';
import PortraitAvatarPhoto from '../../../../components/PortraitAvatarPhoto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MessageCircle, ChevronRight, ExternalLink, Ban, Flag, Briefcase, Building2, FileText, Phone, Mic, Store, Users, UserPlus, UserMinus, Check, X, User as UserIcon } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../../../../stores/authStore';
import { useEventStore } from '../../../../stores/eventStore';
import { useBlockStore } from '../../../../stores/blockStore';
import { supabase, withRetryAndRefresh } from '../../../../lib/supabase';
import { createNotificationAndPush } from '../../../../lib/notifications';
import { sendUserReportAdminPush } from '../../../../lib/pushNotifications';
import { colors } from '../../../../constants/colors';
import { useEventThemeColor } from '../../../../lib/eventTheme';
import HeaderNotificationBell from '../../../../components/HeaderNotificationBell';
import ProfileStackScreenHeader from '../../../../components/ProfileStackScreenHeader';
import ProfileHeroBackdrop from '../../../../components/ProfileHeroBackdrop';
import type { User } from '../../../../lib/types';
import { chatHrefViaProfile, navigateBackToFrom, userProfilePath } from '../../../../lib/navReturn';

const ROLE_LABELS: Record<string, string> = {
  attendee: 'Attendee',
  speaker: 'Speaker',
  vendor: 'Vendor',
};

export default function UserProfileScreen() {
  const params = useLocalSearchParams<{ userId: string; from?: string }>();
  const userId = typeof params.userId === 'string' ? params.userId : params.userId?.[0] ?? '';
  const from = typeof params.from === 'string' ? params.from : params.from?.[0];
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  const { currentEvent } = useEventStore();
  const { blockUser, unblockUser, isBlocked, fetchBlockedUsers, isInteractionBlocked } = useBlockStore();
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [eventRoles, setEventRoles] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [requestSentByMe, setRequestSentByMe] = useState(false);
  const [requestReceivedFromThem, setRequestReceivedFromThem] = useState(false);
  const [connectingId, setConnectingId] = useState(false);
  const [acceptingId, setAcceptingId] = useState(false);
  const [cancellingRequest, setCancellingRequest] = useState(false);
  const [removingConnection, setRemovingConnection] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<string>('spam');
  const [reportDetails, setReportDetails] = useState('');
  const themeColor = useEventThemeColor();

  const isOwnProfile = currentUser?.id === userId;
  const blocked = userId ? isBlocked(userId) : false;

  const goBack = useCallback(() => {
    navigateBackToFrom(router, from, '/(tabs)/feed');
  }, [from, router]);

  const headerRight = useMemo(
    () => (
      <View style={styles.headerRightCluster}>
        <HeaderNotificationBell compact />
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/profile')}
          style={styles.headerProfileTap}
          hitSlop={12}
          activeOpacity={0.85}
        >
          <UserIcon size={24} color={themeColor} strokeWidth={2} />
        </TouchableOpacity>
      </View>
    ),
    [router, themeColor]
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });
    return () => {
      try {
        if (typeof sub?.remove === 'function') sub.remove();
      } catch (_) {
        // Guard against runtimes where subscription.remove is not implemented correctly
      }
    };
  }, [goBack]);

  useEffect(() => {
    if (currentUser?.id) fetchBlockedUsers(currentUser.id);
  }, [currentUser?.id]);

  const fetchUser = useCallback(async () => {
    if (!userId || !currentUser?.id) {
      setLoading(false);
      return;
    }
    setFetchError(null);
    try {
      await withRetryAndRefresh(async () => {
      const [profileRes, contactRes, rolesRes, connectionRes, requestSentRes, requestReceivedRes] = await Promise.all([
        supabase.rpc('get_visible_user_profile', { p_user_id: userId }),
        supabase.rpc('get_user_networking_contact', { p_user_id: userId }),
        currentEvent?.id
          ? supabase
              .from('event_members')
              .select('role, roles')
              .eq('event_id', currentEvent.id)
              .eq('user_id', userId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        currentEvent?.id
          ? supabase
              .from('connections')
              .select('id')
              .eq('event_id', currentEvent.id)
              .eq('user_id', currentUser.id)
              .eq('connected_user_id', userId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        currentEvent?.id
          ? supabase
              .from('connection_requests')
              .select('id')
              .eq('event_id', currentEvent.id)
              .eq('requester_id', currentUser.id)
              .eq('requested_user_id', userId)
              .eq('status', 'pending')
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        currentEvent?.id
          ? supabase
              .from('connection_requests')
              .select('id')
              .eq('event_id', currentEvent.id)
              .eq('requester_id', userId)
              .eq('requested_user_id', currentUser.id)
              .eq('status', 'pending')
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (profileRes.error) throw profileRes.error;
      const profileRow = Array.isArray(profileRes.data)
        ? (profileRes.data[0] as Record<string, unknown> | undefined)
        : (profileRes.data as Record<string, unknown> | null);
      if (!profileRow) {
        // Fallback for older clients / edge cases: public-safe columns only.
        const { data: fallback, error: fallbackErr } = await supabase
          .from('users')
          .select('id, full_name, avatar_url, title, company, linkedin_url, bio, is_active, created_at, updated_at')
          .eq('id', userId)
          .maybeSingle();
        if (fallbackErr) throw fallbackErr;
        if (!fallback) {
          setProfileUser(null);
          setEventRoles([]);
          setFetchError(null);
          return;
        }
        setProfileUser({
          ...(fallback as Omit<User, 'push_token' | 'phone' | 'email' | 'is_platform_admin' | 'last_login_at' | 'session_reminder_skip_same_room'>),
          email: null,
          phone: null,
          push_token: null,
          is_platform_admin: false,
          last_login_at: null,
          session_reminder_skip_same_room: true,
        } as User);
      } else {
        const contactRow = Array.isArray(contactRes.data)
          ? (contactRes.data[0] as { phone?: string | null; email?: string | null } | undefined)
          : (contactRes.data as { phone?: string | null; email?: string | null } | null);
        setProfileUser({
          id: String(profileRow.id),
          email: (contactRow?.email ?? (profileRow.email as string | null) ?? null) as string,
          full_name: String(profileRow.full_name ?? 'Member'),
          avatar_url: (profileRow.avatar_url as string | null) ?? null,
          title: (profileRow.title as string | null) ?? null,
          company: (profileRow.company as string | null) ?? null,
          linkedin_url: (profileRow.linkedin_url as string | null) ?? null,
          bio: (profileRow.bio as string | null) ?? null,
          phone: contactRow?.phone ?? null,
          push_token: null,
          is_active: profileRow.is_active !== false,
          created_at: String(profileRow.created_at ?? new Date().toISOString()),
          updated_at: String(profileRow.updated_at ?? new Date().toISOString()),
          is_platform_admin: profileRow.is_platform_admin === true,
          last_login_at: (profileRow.last_login_at as string | null) ?? null,
          session_reminder_skip_same_room: profileRow.session_reminder_skip_same_room !== false,
        });
      }
      const row = rolesRes.data as { role?: string; roles?: string[] } | null;
      if (row) {
        const roles = (row.roles?.length ? row.roles : row.role ? [row.role] : []).filter(
          (r) => r !== 'admin' && r !== 'super_admin'
        );
        setEventRoles(roles);
      } else {
        setEventRoles([]);
      }
      setIsConnected(!!connectionRes.data);
      setRequestSentByMe(!!requestSentRes.data);
      setRequestReceivedFromThem(!!requestReceivedRes.data);
      });
    } catch (err) {
      if (__DEV__) console.warn('User profile fetch error:', err);
      setProfileUser(null);
      setEventRoles([]);
      setFetchError('Could not load this profile. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [userId, currentEvent?.id, currentUser?.id]);

  // Single load path — avoid double fetch fighting loading/error state.
  useFocusEffect(
    useCallback(() => {
      if (!userId || !currentUser?.id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setFetchError(null);
      let cancelled = false;
      fetchUser()
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [userId, currentUser?.id, fetchUser])
  );

  const handleMessage = () => {
    if (!userId) return;
    if (isInteractionBlocked(userId)) {
      Toast.show({
        type: 'info',
        text1: 'Cannot message',
        text2: 'Messaging is not available for this person.',
      });
      return;
    }
    router.push(chatHrefViaProfile(userId, from) as never);
  };

  const handleRemoveConnection = () => {
    if (!currentUser?.id || !userId || !currentEvent?.id) return;
    const name = profileUser?.full_name ?? 'this person';
    Alert.alert(
      'Remove connection',
      `Remove ${name} from your connections? You can send a new request later if you change your mind.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingConnection(true);
            try {
              const { error: err1 } = await supabase
                .from('connections')
                .delete()
                .eq('event_id', currentEvent.id)
                .eq('user_id', currentUser.id)
                .eq('connected_user_id', userId);
              if (err1) throw err1;
              const { error: err2 } = await supabase
                .from('connections')
                .delete()
                .eq('event_id', currentEvent.id)
                .eq('user_id', userId)
                .eq('connected_user_id', currentUser.id);
              if (err2) throw err2;
              setIsConnected(false);
              Toast.show({ type: 'success', text1: 'Connection removed' });
            } catch (err) {
              console.error('Remove connection error:', err);
              Toast.show({ type: 'error', text1: 'Could not remove', text2: 'Please try again.' });
            } finally {
              setRemovingConnection(false);
            }
          },
        },
      ]
    );
  };

  const handleConnect = async () => {
    if (!currentUser?.id || !userId || !currentEvent?.id) return;
    if (isInteractionBlocked(userId)) {
      Toast.show({
        type: 'info',
        text1: 'Cannot connect',
        text2: 'This person is unavailable for connections.',
      });
      return;
    }
    setConnectingId(true);
    try {
      const { error } = await supabase.from('connection_requests').insert({
        event_id: currentEvent.id,
        requester_id: currentUser.id,
        requested_user_id: userId,
        status: 'pending',
      });
      if (error) {
        if (error.code === '23505') {
          Toast.show({ type: 'info', text1: 'Request already sent', text2: "You've already sent a connection request to this person." });
          setRequestSentByMe(true);
          return;
        }
        throw error;
      }
      setRequestSentByMe(true);
      await createNotificationAndPush(
        userId,
        currentEvent.id,
        'connection_request',
        'Connection request',
        `${currentUser.full_name ?? 'Someone'} wants to connect with you`,
        { requester_id: currentUser.id }
      );
      Toast.show({ type: 'success', text1: 'Request sent', text2: "They'll see it in Community and can accept to connect." });
    } catch (err) {
      console.error('Connect error:', err);
      Toast.show({ type: 'error', text1: 'Could not send request', text2: 'Please try again.' });
    } finally {
      setConnectingId(false);
    }
  };

  const handleCancelRequest = () => {
    if (!currentUser?.id || !userId || !currentEvent?.id) return;
    Alert.alert('Cancel request?', 'They will no longer see your connection request. You can send a new one later.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: async () => {
          setCancellingRequest(true);
          try {
            const { error } = await supabase
              .from('connection_requests')
              .delete()
              .eq('event_id', currentEvent.id)
              .eq('requester_id', currentUser.id)
              .eq('requested_user_id', userId)
              .eq('status', 'pending');
            if (error) throw error;
            setRequestSentByMe(false);
            Toast.show({ type: 'success', text1: 'Request cancelled' });
          } catch (err) {
            console.error('Cancel connection request error:', err);
            Toast.show({ type: 'error', text1: 'Could not cancel', text2: 'Please try again.' });
          } finally {
            setCancellingRequest(false);
          }
        },
      },
    ]);
  };

  const handleAccept = async () => {
    if (!currentUser?.id || !userId || !currentEvent?.id) return;
    if (isInteractionBlocked(userId)) {
      Toast.show({
        type: 'info',
        text1: 'Cannot accept',
        text2: 'This person is unavailable for connections.',
      });
      return;
    }
    setAcceptingId(true);
    try {
      const { data: req } = await supabase
        .from('connection_requests')
        .select('id')
        .eq('event_id', currentEvent.id)
        .eq('requester_id', userId)
        .eq('requested_user_id', currentUser.id)
        .eq('status', 'pending')
        .single();
      if (!req) {
        Toast.show({ type: 'info', text1: 'Request not found', text2: 'It may have been accepted or declined already.' });
        setRequestReceivedFromThem(false);
        setAcceptingId(false);
        return;
      }
      const { error: updateErr } = await supabase
        .from('connection_requests')
        .update({ status: 'accepted' })
        .eq('id', (req as { id: string }).id);
      if (updateErr) throw updateErr;
      const { error: ins1 } = await supabase.from('connections').insert({
        event_id: currentEvent.id,
        user_id: currentUser.id,
        connected_user_id: userId,
      });
      if (ins1) throw ins1;
      const { error: ins2 } = await supabase.from('connections').insert({
        event_id: currentEvent.id,
        user_id: userId,
        connected_user_id: currentUser.id,
      });
      if (ins2) throw ins2;
      await createNotificationAndPush(
        userId,
        currentEvent.id,
        'system',
        'Connection accepted',
        `${currentUser.full_name ?? 'Someone'} accepted your connection request`,
        { chat_user_id: currentUser.id }
      );
      setIsConnected(true);
      setRequestReceivedFromThem(false);
      Toast.show({ type: 'success', text1: 'Connected', text2: "You're now connected. You can message them." });
    } catch (err) {
      console.error('Accept error:', err);
      Toast.show({ type: 'error', text1: 'Could not accept', text2: 'Please try again.' });
    } finally {
      setAcceptingId(false);
    }
  };

  const handleDecline = async () => {
    if (!currentUser?.id || !userId || !currentEvent?.id) return;
    try {
      const { data: req } = await supabase
        .from('connection_requests')
        .select('id')
        .eq('event_id', currentEvent.id)
        .eq('requester_id', userId)
        .eq('requested_user_id', currentUser.id)
        .eq('status', 'pending')
        .single();
      if (req) {
        const { error: updateErr } = await supabase
          .from('connection_requests')
          .update({ status: 'declined' })
          .eq('id', (req as { id: string }).id);
        if (updateErr) throw updateErr;
      }
      setRequestReceivedFromThem(false);
      Toast.show({ type: 'success', text1: 'Declined', text2: 'Connection request declined.' });
    } catch (err) {
      console.error('Decline error:', err);
      Toast.show({ type: 'error', text1: 'Could not decline', text2: 'Please try again.' });
    }
  };

  const handleEdit = () => {
    router.push(
      `/profile/edit?from=${encodeURIComponent(userProfilePath(userId, from))}` as never
    );
  };

  const handleBlock = () => {
    if (!currentUser?.id || !userId) return;
    Alert.alert(
      blocked ? 'Unblock user?' : 'Block user?',
      blocked
        ? 'You will see their posts and can message them again.'
        : 'You will no longer see their posts and they cannot message you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: blocked ? 'Unblock' : 'Block',
          style: blocked ? 'default' : 'destructive',
          onPress: async () => {
            const fn = blocked ? unblockUser : blockUser;
            const { error } = await fn(currentUser.id, userId);
            if (error) Alert.alert('Error', error);
            else if (!blocked) goBack();
          },
        },
      ]
    );
  };

  const handleReport = () => setShowReportModal(true);

  const submitReport = async () => {
    if (!currentUser?.id || !userId) return;
    if (!currentEvent?.id) {
      Alert.alert('Select an event', 'Join or select an event before submitting a report.');
      return;
    }
    try {
      const { data, error } = await supabase
        .from('user_reports')
        .insert({
          reporter_id: currentUser.id,
          reported_user_id: userId,
          event_id: currentEvent.id,
          reason: reportReason,
          details: reportDetails.trim() || null,
        })
        .select('id')
        .single();
      if (error) throw error;
      if (data?.id) void sendUserReportAdminPush(data.id);
      setShowReportModal(false);
      setReportReason('spam');
      setReportDetails('');
      Alert.alert('Report sent', 'Thank you. We will review this report.');
      goBack();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to submit report.');
    }
  };

  const openPhone = () => {
    const p = profileUser?.phone?.trim();
    if (!p) return;
    Linking.openURL(`tel:${p}`).catch(() => Alert.alert('Error', 'Could not open phone.'));
  };

  const openLinkedIn = () => {
    const url = profileUser?.linkedin_url;
    if (!url) return;
    const toOpen = url.startsWith('http') ? url : `https://${url}`;
    Linking.openURL(toOpen).catch(() =>
      Alert.alert('Error', 'Could not open LinkedIn.')
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Profile" onBack={goBack} right={headerRight} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={themeColor} />
          <Text style={styles.loadingText}>Loading profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Profile" onBack={goBack} right={headerRight} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>{fetchError || 'Could not load this profile'}</Text>
          <Text style={styles.errorSubtext}>Tap Try again or go back.</Text>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              setFetchError(null);
              setLoading(true);
              fetchUser();
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.backBtnText, { color: themeColor }]}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.backBtn, { marginTop: 12 }]} onPress={goBack}>
            <Text style={[styles.backBtnText, { color: themeColor }]}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!profileUser) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Profile" onBack={goBack} right={headerRight} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Profile not found.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={goBack}>
            <Text style={styles.backBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader
        variant="back"
        title="Profile"
        onBack={goBack}
        right={headerRight}
      />
      <ScrollView style={styles.scrollFlex} contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          {profileUser.avatar_url ? (
            <View style={styles.heroBackdrop} pointerEvents="none">
              <ProfileHeroBackdrop avatarUrl={profileUser.avatar_url} />
            </View>
          ) : null}
          <View style={styles.heroForeground}>
            <View style={styles.heroAvatarWrap}>
              {profileUser.avatar_url ? (
                <PortraitAvatarPhoto uri={profileUser.avatar_url} transition={150} />
              ) : (
                <Avatar uri={null} name={profileUser.full_name} size={112} />
              )}
            </View>
            <Text style={styles.heroName}>{profileUser.full_name ?? 'Unknown'}</Text>
          </View>
        </View>
        <View style={styles.content}>
        <View style={styles.header}>
          {eventRoles.length > 0 ? (
            <View style={styles.rolesRow}>
              {eventRoles.map((r) => (
                <View key={r} style={[styles.roleBadge, r === 'speaker' && { backgroundColor: `${themeColor}22` }, r === 'vendor' && styles.roleVendor]}>
                  {r === 'speaker' ? <Mic size={14} color={themeColor} /> : null}
                  {r === 'vendor' ? <Store size={14} color={colors.secondary} /> : null}
                  {r === 'attendee' ? <Users size={14} color={colors.textMuted} /> : null}
                  <Text style={styles.roleBadgeText}>{ROLE_LABELS[r] ?? r}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {(profileUser.title || profileUser.company || profileUser.bio || profileUser.phone) ? (
            <View style={styles.infoCardWrap}>
              <Text style={styles.sectionLabel}>Details</Text>
              <View style={styles.infoCard}>
              {profileUser.title ? (
                <View style={styles.infoRow}>
                  <Briefcase size={18} color={colors.textMuted} />
                  <Text style={styles.infoText}>{profileUser.title}</Text>
                </View>
              ) : null}
              {profileUser.company ? (
                <View style={styles.infoRow}>
                  <Building2 size={18} color={colors.textMuted} />
                  <Text style={styles.infoText}>{profileUser.company}</Text>
                </View>
              ) : null}
              {profileUser.bio ? (
                <View style={[styles.infoRow, styles.infoRowBio]}>
                  <FileText size={18} color={colors.textMuted} />
                  <Text style={[styles.infoText, styles.bioText]} selectable>{profileUser.bio}</Text>
                </View>
              ) : null}
              {profileUser.phone ? (
                <TouchableOpacity style={styles.infoRow} onPress={openPhone} activeOpacity={0.7}>
                  <Phone size={18} color={colors.textMuted} />
                  <Text style={[styles.infoText, styles.phoneText, { color: themeColor }]}>{profileUser.phone}</Text>
                </TouchableOpacity>
              ) : null}
              </View>
            </View>
          ) : null}

          {profileUser.linkedin_url ? (
            <TouchableOpacity style={styles.linkedinBtn} onPress={openLinkedIn} activeOpacity={0.7}>
              <ExternalLink size={18} color={themeColor} />
              <Text style={[styles.linkedinText, { color: themeColor }]}>View LinkedIn profile</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>{isOwnProfile ? 'Account' : 'Connection & actions'}</Text>
        <View style={styles.actions}>
          {isOwnProfile ? (
            <TouchableOpacity style={styles.menuRow} onPress={handleEdit} activeOpacity={0.7}>
              <Text style={styles.menuText}>Edit profile</Text>
              <ChevronRight size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ) : (
            <>
              <Text style={styles.actionsSectionLabel}>Connection</Text>
              {isConnected ? (
                <View style={styles.connectedActions}>
                  <TouchableOpacity style={[styles.messageBtn, { backgroundColor: themeColor }]} onPress={handleMessage} activeOpacity={0.7}>
                    <MessageCircle size={22} color="#fff" />
                    <Text style={styles.messageBtnText}>Message</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.removeConnectionBtn}
                    onPress={handleRemoveConnection}
                    disabled={removingConnection}
                    activeOpacity={0.7}
                  >
                    {removingConnection ? (
                      <ActivityIndicator size="small" color={colors.textMuted} />
                    ) : (
                      <>
                        <UserMinus size={20} color={colors.textMuted} />
                        <Text style={styles.removeConnectionBtnText}>Remove connection</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              ) : requestReceivedFromThem ? (
                <View style={styles.profileRequestRow}>
                  <TouchableOpacity
                    style={[styles.profileBtn, styles.profileAcceptBtn, { backgroundColor: themeColor }]}
                    onPress={handleAccept}
                    disabled={acceptingId}
                  >
                    {acceptingId ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Check size={18} color="#fff" />
                        <Text style={styles.profileAcceptBtnText}>Accept</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.profileBtn, styles.profileDeclineBtn]}
                    onPress={handleDecline}
                    disabled={acceptingId}
                  >
                    <X size={18} color={colors.textSecondary} />
                    <Text style={styles.profileDeclineBtnText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              ) : requestSentByMe ? (
                <TouchableOpacity
                  style={[styles.profileBtn, styles.profileDeclineBtn]}
                  onPress={handleCancelRequest}
                  disabled={cancellingRequest}
                  activeOpacity={0.7}
                >
                  {cancellingRequest ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : (
                    <>
                      <X size={18} color={colors.textSecondary} />
                      <Text style={styles.profileDeclineBtnText}>Cancel request</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.messageBtn, { backgroundColor: themeColor }]}
                  onPress={handleConnect}
                  disabled={connectingId}
                  activeOpacity={0.7}
                >
                  {connectingId ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <UserPlus size={22} color="#fff" />
                      <Text style={styles.messageBtnText}>Connect</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              <Text style={[styles.actionsSectionLabel, styles.actionsSectionLabelSecond]}>Actions</Text>
              <TouchableOpacity style={styles.blockReportRow} onPress={handleBlock} activeOpacity={0.7}>
                <Ban size={20} color={blocked ? colors.secondary : colors.textMuted} />
                <Text style={[styles.blockReportText, blocked && styles.unblockText]}>
                  {blocked ? 'Unblock' : 'Block'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.blockReportRow} onPress={handleReport} activeOpacity={0.7}>
                <Flag size={20} color={colors.textMuted} />
                <Text style={styles.blockReportText}>Report</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        </View>
      </ScrollView>

      <Modal visible={showReportModal} transparent animationType="slide">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowReportModal(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.modalContent}>
            <Text style={styles.modalTitle}>Report user</Text>
            <Text style={styles.modalLabel}>Reason</Text>
            <View style={styles.reasonRow}>
              {(['spam', 'harassment', 'inappropriate', 'other'] as const).map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.reasonChip, reportReason === r && { backgroundColor: themeColor }]}
                  onPress={() => setReportReason(r)}
                >
                  <Text style={[styles.reasonChipText, reportReason === r && styles.reasonChipTextActive]}>
                    {r}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.modalLabel}>Additional details (optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={reportDetails}
              onChangeText={setReportDetails}
              placeholder="Describe what happened..."
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowReportModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSubmit} onPress={submitReport}>
                <Text style={styles.modalSubmitText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerRightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  headerProfileTap: {
    marginHorizontal: 8,
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollFlex: { flex: 1 },
  scrollContent: {
    paddingBottom: 32,
    flexGrow: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  backBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtnText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  hero: {
    width: '100%',
    alignSelf: 'stretch',
    minHeight: 268,
    backgroundColor: colors.surfaceHover ?? '#eef1f5',
    paddingTop: 20,
    paddingBottom: 28,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    position: 'relative',
  },
  heroBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  heroForeground: {
    alignItems: 'center',
    width: '100%',
    paddingBottom: 4,
    paddingHorizontal: 20,
  },
  heroName: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    marginTop: 18,
    marginBottom: 2,
    paddingHorizontal: 12,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  heroAvatarWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 3,
    borderColor: colors.background,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 5,
    backgroundColor: colors.surfaceHover,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 12,
    paddingHorizontal: 0,
  },
  rolesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 14,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: colors.borderLight,
  },
  roleSpeaker: {
    backgroundColor: colors.primaryFaded,
  },
  roleVendor: {
    backgroundColor: colors.secondary + '25',
  },
  roleBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  infoCardWrap: {
    width: '100%',
    marginBottom: 16,
  },
  infoCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  infoRowBio: {
    marginBottom: 0,
  },
  infoText: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    lineHeight: 22,
  },
  bioText: {
    color: colors.textSecondary,
  },
  phoneText: {
    color: colors.primary,
    fontWeight: '500',
  },
  linkedinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 0,
    marginBottom: 20,
  },
  linkedinText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '600',
  },
  actionsSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionsSectionLabelSecond: {
    marginTop: 14,
  },
  actions: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 0,
  },
  menuText: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  messageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  messageBtnText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  connectedActions: {
    flexDirection: 'column',
    gap: 10,
    marginBottom: 12,
  },
  removeConnectionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  removeConnectionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  profileRequestRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  profileBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  profileAcceptBtn: {
    backgroundColor: colors.primary,
  },
  profileAcceptBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  profileDeclineBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileDeclineBtnText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  profileMutedBtn: {
    backgroundColor: colors.borderLight,
  },
  profileMutedBtnText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  blockReportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 0,
    paddingTop: 14,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  blockReportText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  unblockText: {
    color: colors.secondary,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  reasonChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  reasonChipActive: {
    backgroundColor: colors.primary,
  },
  reasonChipText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  reasonChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalCancel: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCancelText: {
    fontSize: 16,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  modalSubmit: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: colors.danger,
  },
  modalSubmitText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
});
