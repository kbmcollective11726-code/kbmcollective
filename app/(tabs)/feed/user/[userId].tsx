import { useEffect, useState } from 'react';
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
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MessageCircle, ChevronRight, ChevronLeft, ExternalLink, Ban, Flag, Briefcase, Building2, FileText, Phone, Mic, Store, Users, UserPlus, Check, X } from 'lucide-react-native';
import { useAuthStore } from '../../../../stores/authStore';
import { useEventStore } from '../../../../stores/eventStore';
import { useBlockStore } from '../../../../stores/blockStore';
import { supabase } from '../../../../lib/supabase';
import { awardPoints } from '../../../../lib/points';
import { colors } from '../../../../constants/colors';
import Avatar from '../../../../components/Avatar';
import type { User } from '../../../../lib/types';

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
  const navigation = useNavigation();
  const { user: currentUser } = useAuthStore();
  const { currentEvent } = useEventStore();
  const { blockUser, unblockUser, isBlocked, fetchBlockedUsers } = useBlockStore();
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [eventRoles, setEventRoles] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [requestSentByMe, setRequestSentByMe] = useState(false);
  const [requestReceivedFromThem, setRequestReceivedFromThem] = useState(false);
  const [connectingId, setConnectingId] = useState(false);
  const [acceptingId, setAcceptingId] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<string>('spam');
  const [reportDetails, setReportDetails] = useState('');

  const isOwnProfile = currentUser?.id === userId;
  const blocked = userId ? isBlocked(userId) : false;

  const goBack = () => {
    if (from) {
      router.replace(decodeURIComponent(from) as any);
    } else {
      router.back();
    }
  };

  useEffect(() => {
    if (from && typeof from === 'string') {
      const returnPath = decodeURIComponent(from);
      navigation.setOptions({
        headerBackVisible: false,
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => router.replace(returnPath as any)}
            style={{ padding: 8, marginLeft: 4 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
        ),
      });
    }
  }, [from, navigation, router]);

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
  }, [from, router]);

  useEffect(() => {
    if (currentUser?.id) fetchBlockedUsers(currentUser.id);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    const fetchUser = async () => {
      if (!currentUser?.id) {
        setLoading(false);
        return;
      }
      try {
        const [userRes, rolesRes, connectionRes, requestSentRes, requestReceivedRes] = await Promise.all([
          supabase.from('users').select('*').eq('id', userId).single(),
          currentEvent?.id
            ? supabase
                .from('event_members')
                .select('role, roles')
                .eq('event_id', currentEvent.id)
                .eq('user_id', userId)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          currentEvent?.id
            ? supabase
                .from('connections')
                .select('id')
                .eq('event_id', currentEvent.id)
                .eq('user_id', currentUser.id)
                .eq('connected_user_id', userId)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          currentEvent?.id
            ? supabase
                .from('connection_requests')
                .select('id')
                .eq('event_id', currentEvent.id)
                .eq('requester_id', currentUser.id)
                .eq('requested_user_id', userId)
                .eq('status', 'pending')
                .maybeSingle()
            : Promise.resolve({ data: null }),
          currentEvent?.id
            ? supabase
                .from('connection_requests')
                .select('id')
                .eq('event_id', currentEvent.id)
                .eq('requester_id', userId)
                .eq('requested_user_id', currentUser.id)
                .eq('status', 'pending')
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        if (userRes.error) throw userRes.error;
        setProfileUser(userRes.data as User);
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
      } catch (err) {
        console.error('User profile fetch error:', err);
        setProfileUser(null);
        setEventRoles([]);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [userId, currentEvent?.id, currentUser?.id]);

  const handleMessage = () => {
    if (userId) router.push(`/profile/chat/${userId}?from=${encodeURIComponent(`/feed/user/${userId}`)}` as any);
  };

  const handleConnect = async () => {
    if (!currentUser?.id || !userId || !currentEvent?.id) return;
    setConnectingId(true);
    try {
      const { error } = await supabase.from('connection_requests').insert({
        event_id: currentEvent.id,
        requester_id: currentUser.id,
        requested_user_id: userId,
        status: 'pending',
      });
      if (error) throw error;
      setRequestSentByMe(true);
    } catch (err) {
      console.error('Connect error:', err);
    } finally {
      setConnectingId(false);
    }
  };

  const handleAccept = async () => {
    if (!currentUser?.id || !userId || !currentEvent?.id) return;
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
        setAcceptingId(false);
        return;
      }
      await supabase.from('connection_requests').update({ status: 'accepted' }).eq('id', (req as { id: string }).id);
      await supabase.from('connections').insert({
        event_id: currentEvent.id,
        user_id: currentUser.id,
        connected_user_id: userId,
      });
      await supabase.from('connections').insert({
        event_id: currentEvent.id,
        user_id: userId,
        connected_user_id: currentUser.id,
      });
      await awardPoints(currentUser.id, currentEvent.id, 'connect');
      setIsConnected(true);
      setRequestReceivedFromThem(false);
    } catch (err) {
      console.error('Accept error:', err);
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
        await supabase.from('connection_requests').update({ status: 'declined' }).eq('id', (req as { id: string }).id);
      }
      setRequestReceivedFromThem(false);
    } catch (err) {
      console.error('Decline error:', err);
    }
  };

  const handleEdit = () => {
    router.push(`/profile/edit?from=${encodeURIComponent(`/feed/user/${userId}`)}` as any);
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
    try {
      const { error } = await supabase.from('user_reports').insert({
        reporter_id: currentUser.id,
        reported_user_id: userId,
        reason: reportReason,
        details: reportDetails.trim() || null,
      });
      if (error) throw error;
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
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!profileUser) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
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
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <View style={styles.heroAvatarWrap}>
            <Avatar uri={profileUser.avatar_url} name={profileUser.full_name} size={108} />
          </View>
        </View>
        <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.name}>{profileUser.full_name ?? 'Unknown'}</Text>

          {eventRoles.length > 0 ? (
            <View style={styles.rolesRow}>
              {eventRoles.map((r) => (
                <View key={r} style={[styles.roleBadge, r === 'speaker' && styles.roleSpeaker, r === 'vendor' && styles.roleVendor]}>
                  {r === 'speaker' ? <Mic size={14} color={colors.primary} /> : null}
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
                <View style={styles.infoRow}>
                  <FileText size={18} color={colors.textMuted} />
                  <Text style={[styles.infoText, styles.bioText]}>{profileUser.bio}</Text>
                </View>
              ) : null}
              {profileUser.phone ? (
                <TouchableOpacity style={styles.infoRow} onPress={openPhone} activeOpacity={0.7}>
                  <Phone size={18} color={colors.textMuted} />
                  <Text style={[styles.infoText, styles.phoneText]}>{profileUser.phone}</Text>
                </TouchableOpacity>
              ) : null}
              </View>
            </View>
          ) : null}

          {profileUser.linkedin_url ? (
            <TouchableOpacity style={styles.linkedinBtn} onPress={openLinkedIn} activeOpacity={0.7}>
              <ExternalLink size={18} color={colors.primary} />
              <Text style={styles.linkedinText}>View LinkedIn profile</Text>
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
                <TouchableOpacity style={styles.messageBtn} onPress={handleMessage} activeOpacity={0.7}>
                  <MessageCircle size={22} color="#fff" />
                  <Text style={styles.messageBtnText}>Message</Text>
                </TouchableOpacity>
              ) : requestReceivedFromThem ? (
                <View style={styles.profileRequestRow}>
                  <TouchableOpacity
                    style={[styles.profileBtn, styles.profileAcceptBtn]}
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
                <View style={[styles.profileBtn, styles.profileMutedBtn]}>
                  <Text style={styles.profileMutedBtnText}>Request sent</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.messageBtn}
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
                  style={[styles.reasonChip, reportReason === r && styles.reasonChipActive]}
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
  scrollContent: {
    paddingBottom: 88,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 0,
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
    backgroundColor: colors.surfaceHover ?? '#eef1f5',
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarWrap: {
    width: 108,
    height: 108,
    borderRadius: 54,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 12,
    paddingHorizontal: 0,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginTop: 0,
    marginBottom: 10,
    letterSpacing: -0.3,
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
