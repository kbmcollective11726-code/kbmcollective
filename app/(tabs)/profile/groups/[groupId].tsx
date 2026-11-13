import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from "@react-navigation/native";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Send, ImageIcon, Users, UserPlus, UserMinus, Trash2 } from 'lucide-react-native';
import { useAuthStore } from '../../../../stores/authStore';
import { useEventStore } from '../../../../stores/eventStore';
import { useRolePreviewContext } from '../../../../hooks/useRolePreviewContext';
import { supabase } from '../../../../lib/supabase';
import { createNotificationAndPush } from '../../../../lib/notifications';
import { sendAnnouncementPush } from '../../../../lib/pushNotifications';
import { pickImage } from '../../../../lib/image';
import { uploadImage } from '../../../../lib/image';
import { colors } from '../../../../constants/colors';
import { themeColorWithAlpha, useEventThemeColor } from '../../../../lib/eventTheme';
import { format } from 'date-fns';
import Avatar from '../../../../components/Avatar';
import ProfileStackScreenHeader from '../../../../components/ProfileStackScreenHeader';
import { groupsListHref, navigateBackToFrom } from '../../../../lib/navReturn';

type GroupMessageRow = {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
  created_at: string;
  sender_name?: string;
  sender_avatar?: string | null;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidGroupId(id: string): boolean {
  return !!id && UUID_REGEX.test(id);
}

export default function GroupChatScreen() {
  const params = useLocalSearchParams<{ groupId: string; from?: string }>();
  const rawGroupId = typeof params.groupId === 'string' ? params.groupId : params.groupId?.[0] ?? '';
  const groupId = isValidGroupId(rawGroupId) ? rawGroupId : '';
  const from = typeof params.from === 'string' ? params.from : params.from?.[0];
  const router = useRouter();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const { applyEventAdmin } = useRolePreviewContext();
  const themeColor = useEventThemeColor();
  const themeFaded = themeColorWithAlpha(themeColor, '18');

  const goBack = useCallback(() => {
    navigateBackToFrom(router, from, '/(tabs)/profile/groups');
  }, [router, from]);

  // `/groups/index` can match this dynamic route with groupId="index" — bounce to the list.
  useEffect(() => {
    if (rawGroupId === 'index' || rawGroupId === 'new') {
      router.replace(groupsListHref(from) as never);
    }
  }, [rawGroupId, from, router]);
  const [groupName, setGroupName] = useState('');
  const [messages, setMessages] = useState<GroupMessageRow[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [manageVisible, setManageVisible] = useState(false);
  const [manageMembers, setManageMembers] = useState<{ user_id: string; full_name: string; avatar_url: string | null }[]>([]);
  const [addableMembers, setAddableMembers] = useState<{ user_id: string; full_name: string; avatar_url: string | null }[]>([]);
  const [manageLoading, setManageLoading] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);

  const fetchGroupAndMembership = useCallback(async () => {
    if (!groupId || !user?.id) return;
    try {
      let isEventAdminResult = false;
      if (currentEvent?.id) {
        const { data: roleData } = await supabase
          .from('event_members')
          .select('role, roles')
          .eq('event_id', currentEvent.id)
          .eq('user_id', user.id)
          .maybeSingle();
        const row = roleData as { role?: string; roles?: string[] } | null;
        const role = row?.role ?? 'attendee';
        const roles = Array.isArray(row?.roles) ? row.roles : [];
        isEventAdminResult =
          role === 'admin' ||
          role === 'super_admin' ||
          roles.includes('admin') ||
          roles.includes('super_admin');
        isEventAdminResult = applyEventAdmin(isEventAdminResult);
        setIsEventAdmin(isEventAdminResult);
      }
      const { data: groupData, error: groupError } = await supabase
        .from('chat_groups')
        .select('name, created_by')
        .eq('id', groupId)
        .maybeSingle();
      if (groupError) throw groupError;
      const group = groupData as { name: string; created_by: string | null } | null;
      if (!group) {
        setIsMember(false);
        setLoading(false);
        return;
      }
      setGroupName(group.name ?? '');
      const isCreator = group.created_by === user.id;

      // Creators and event admins can open the chat immediately (don't block on members-table RLS).
      if (isCreator || isEventAdminResult) {
        setIsMember(true);
        void supabase
          .from('chat_group_members')
          .insert({ group_id: groupId, user_id: user.id })
          .then(() => {}, () => {});
        return;
      }

      const { data: memberData } = await supabase
        .from('chat_group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .maybeSingle();
      const member = !!memberData;
      setIsMember(member);
      if (!member) setLoading(false);
    } catch (err) {
      console.error('Group membership fetch error:', err);
      setIsMember(false);
      setLoading(false);
    }
  }, [groupId, user?.id, currentEvent?.id, applyEventAdmin]);

  const fetchMessages = useCallback(async () => {
    if (!groupId || !user?.id) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('group_messages')
        .select('id, group_id, sender_id, content, attachment_url, attachment_type, created_at')
        .eq('group_id', groupId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as GroupMessageRow[];
      const senderIds = [...new Set(rows.map((r) => r.sender_id))];
      if (senderIds.length > 0) {
        const { data: usersData } = await supabase
          .from('users')
          .select('id, full_name, avatar_url')
          .in('id', senderIds);
        const userMap = new Map(
          (usersData ?? []).map((u: { id: string; full_name: string; avatar_url: string | null }) => [u.id, u])
        );
        rows.forEach((r) => {
          const u = userMap.get(r.sender_id);
          if (u) {
            r.sender_name = (u as { full_name: string }).full_name;
            r.sender_avatar = (u as { avatar_url: string | null }).avatar_url;
          }
        });
      }
      setMessages(rows);
    } catch (err) {
      console.error('Group messages fetch error:', err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [groupId, user?.id]);

  useEffect(() => {
    if (!groupId) {
      router.replace('/(tabs)/profile/groups' as any);
      return;
    }
    fetchGroupAndMembership().catch(() => {});
  }, [groupId, fetchGroupAndMembership, router]);

  useFocusEffect(
    useCallback(() => {
      if (groupId && user?.id) {
        fetchGroupAndMembership().catch(() => {});
      }
    }, [groupId, user?.id, fetchGroupAndMembership])
  );

  const fetchManageData = useCallback(async () => {
    if (!groupId || !currentEvent?.id || !user?.id) return;
    setManageLoading(true);
    try {
      const { data: inGroup } = await supabase
        .from('chat_group_members')
        .select('user_id, users!inner(full_name, avatar_url)')
        .eq('group_id', groupId);
      type Row = { user_id: string; users: { full_name: string; avatar_url: string | null } | Array<{ full_name: string; avatar_url: string | null }> };
      const members = (inGroup ?? []).map((r: Row) => {
        const u = Array.isArray(r.users) ? r.users[0] : r.users;
        return { user_id: r.user_id, full_name: u?.full_name ?? '', avatar_url: u?.avatar_url ?? null };
      });
      setManageMembers(members);
      const inGroupIds = new Set(members.map((m) => m.user_id));
      const { data: eventMemberRows } = await supabase
        .from('event_members')
        .select('user_id, users!inner(full_name, avatar_url)')
        .eq('event_id', currentEvent.id)
        .eq('is_hidden', false);
      const addable = (eventMemberRows ?? [])
        .map((r: Row) => {
          const u = Array.isArray(r.users) ? r.users[0] : r.users;
          return { user_id: r.user_id, full_name: u?.full_name ?? '', avatar_url: u?.avatar_url ?? null };
        })
        .filter((m) => !inGroupIds.has(m.user_id));
      setAddableMembers(addable);
    } catch (_) {
      setManageMembers([]);
      setAddableMembers([]);
    } finally {
      setManageLoading(false);
    }
  }, [groupId, currentEvent?.id, user?.id]);

  useEffect(() => {
    if (manageVisible) fetchManageData();
  }, [manageVisible, fetchManageData]);

  useEffect(() => {
    if (manageVisible) setRenameDraft(groupName);
  }, [manageVisible, groupName]);

  const handleRenameGroup = async () => {
    const trimmed = renameDraft.trim();
    if (!trimmed || !groupId || !isEventAdmin) return;
    if (trimmed === groupName) return;
    setSavingName(true);
    try {
      const { error } = await supabase.from('chat_groups').update({ name: trimmed }).eq('id', groupId);
      if (error) throw error;
      setGroupName(trimmed);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not rename group.');
    } finally {
      setSavingName(false);
    }
  };

  const handleDeleteGroup = () => {
    if (!groupId || !isEventAdmin) return;
    Alert.alert(
      'Delete group?',
      `Delete "${groupName || 'this group'}"? All messages will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingGroup(true);
            try {
              const { error } = await supabase.from('chat_groups').delete().eq('id', groupId);
              if (error) throw error;
              setManageVisible(false);
              router.replace('/(tabs)/profile/groups' as any);
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Could not delete group.');
            } finally {
              setDeletingGroup(false);
            }
          },
        },
      ]
    );
  };

  const addMemberToGroup = async (uid: string) => {
    if (!groupId) return;
    const { error } = await supabase.from('chat_group_members').insert({ group_id: groupId, user_id: uid });
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    const title = `You were added to "${groupName || 'Group'}"`;
    createNotificationAndPush(
      uid,
      currentEvent?.id ?? null,
      'system',
      title,
      'Tap to open the group.',
      { group_id: groupId }
    ).catch(() => {});
    fetchManageData();
  };

  const removeMemberFromGroup = async (uid: string) => {
    if (!groupId || uid === user?.id) return;
    const { error } = await supabase.from('chat_group_members').delete().eq('group_id', groupId).eq('user_id', uid);
    if (error) Alert.alert('Error', error.message);
    else fetchManageData();
  };

  useEffect(() => {
    if (isMember !== true) return;
    fetchMessages().catch(() => {});
  }, [isMember, fetchMessages]);

  useEffect(() => {
    if (isMember !== null || !groupId) return;
    const timer = setTimeout(() => {
      setIsMember((current) => {
        if (current === null) {
          console.warn('Group chat membership check timed out');
          setLoading(false);
          return false;
        }
        return current;
      });
    }, 15000);
    return () => clearTimeout(timer);
  }, [isMember, groupId]);

  useEffect(() => {
    if (!groupId || !user?.id || isMember !== true) return;
    const channel = supabase
      .channel(`group_messages:${groupId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
        () => { fetchMessages().catch(() => {}); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [groupId, user?.id, isMember, fetchMessages]);

  const sendMessage = async () => {
    const text = input.trim();
    const hasImage = !!imageUri;
    if ((!text && !hasImage) || !user?.id || !groupId || !currentEvent?.id) return;
    setSending(true);
    setInput('');
    const imageToSend = imageUri;
    setImageUri(null);
    try {
      let attachmentUrl: string | null = null;
      if (imageToSend) {
        const url = await uploadImage(imageToSend, currentEvent.id, user.id, 'event-photos', { folder: 'group-chat' });
        attachmentUrl = url;
      }
      const { error } = await supabase.from('group_messages').insert({
        group_id: groupId,
        sender_id: user.id,
        content: text || '',
        attachment_url: attachmentUrl,
        attachment_type: attachmentUrl ? 'image' : null,
      });
      if (error) throw error;
      await fetchMessages();

      // Notify other group members via device push only (Chat hub covers in-app).
      const { data: members } = await supabase
        .from('chat_group_members')
        .select('user_id')
        .eq('group_id', groupId);
      const recipientIds = (members ?? []).map((m: { user_id: string }) => m.user_id).filter((id: string) => id !== user.id);
      if (recipientIds.length > 0 && currentEvent?.id) {
        const senderName = (user as { full_name?: string })?.full_name ?? 'Someone';
        const title = `${senderName} in ${groupName || 'Group'}`;
        const body = (text || (attachmentUrl ? 'Photo' : '')).slice(0, 100) || 'New message';
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          sendAnnouncementPush(session.access_token, currentEvent.id, title, body, recipientIds, { groupId }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Send group message error:', err);
      setInput(text);
      setImageUri(imageToSend || null);
      Alert.alert('Send failed', err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  const handlePickImage = () => {
    Alert.alert('Add photo', 'Choose how to add a photo', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Take photo',
        onPress: () => {
          pickImage('camera').then((uri) => {
            if (uri) setImageUri(uri);
          });
        },
      },
      {
        text: 'Photo library',
        onPress: () => {
          pickImage('library').then((uri) => {
            if (uri) setImageUri(uri);
          });
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: GroupMessageRow }) => {
    const isMe = item.sender_id === user?.id;
    const hasAttachment = !!item.attachment_url;
    const contentTrimmed = (item.content || '').trim();
    return (
      <View style={[styles.bubbleWrap, isMe ? styles.bubbleWrapMe : styles.bubbleWrapThem]}>
        {!isMe && item.sender_name ? (
          <Text style={styles.senderName} numberOfLines={1}>
            {item.sender_name}
          </Text>
        ) : null}
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, isMe && { backgroundColor: themeColor }]}>
          {hasAttachment ? (
            <TouchableOpacity
              onPress={() => setExpandedImageUrl(item.attachment_url!)}
              activeOpacity={0.9}
              style={styles.attachmentWrap}
            >
              <Image source={{ uri: item.attachment_url! }} style={styles.attachmentImage} resizeMode="cover" />
            </TouchableOpacity>
          ) : null}
          {contentTrimmed !== '' ? (
            <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
          ) : null}
          <Text style={[styles.time, isMe && styles.timeMe]}>{format(new Date(item.created_at), 'h:mm a')}</Text>
        </View>
      </View>
    );
  };

  const canSend = (input.trim() || imageUri) && !sending;

  if (!groupId || !user?.id) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Group" onBack={goBack} />
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>
            {rawGroupId === 'index' || rawGroupId === 'new'
              ? 'Opening groups…'
              : 'Invalid group.'}
          </Text>
          {rawGroupId !== 'index' && rawGroupId !== 'new' ? (
            <TouchableOpacity
              style={{
                marginTop: 16,
                paddingVertical: 12,
                paddingHorizontal: 20,
                borderRadius: 10,
                backgroundColor: themeColor,
              }}
              onPress={goBack}
              activeOpacity={0.8}
            >
              <Text style={{ color: colors.textOnPrimary, fontWeight: '600', fontSize: 16 }}>Back to groups</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  if (isMember === null || (isMember === true && loading && messages.length === 0)) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title={groupName || 'Group'} onBack={goBack} />
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={themeColor} />
          <Text style={styles.placeholderText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isMember === false) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title={groupName || 'Group'} onBack={goBack} />
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>You’re not a member of this group.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader
        variant="back"
        title={groupName || 'Group'}
        onBack={goBack}
        right={
          isEventAdmin && isMember ? (
            <TouchableOpacity
              onPress={() => setManageVisible(true)}
              style={{ padding: 8 }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Users size={22} color={themeColor} />
            </TouchableOpacity>
          ) : undefined
        }
      />
      <Modal visible={!!expandedImageUrl} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setExpandedImageUrl(null)}>
          {expandedImageUrl ? (
            <Image source={{ uri: expandedImageUrl }} style={styles.expandedImage} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>
      <Modal visible={manageVisible} animationType="slide" transparent>
        <View style={styles.manageModalBackdrop}>
          <View style={styles.manageModal}>
            <View style={styles.manageModalHeader}>
              <Text style={styles.manageModalTitle}>Manage group</Text>
              <TouchableOpacity onPress={() => setManageVisible(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={[styles.manageModalClose, { color: themeColor }]}>Done</Text>
              </TouchableOpacity>
            </View>
            {manageLoading ? (
              <ActivityIndicator size="small" color={themeColor} style={{ marginVertical: 24 }} />
            ) : (
              <>
                <View style={styles.manageTopPanel}>
                  <Text style={styles.manageSectionTitle}>Edit group name</Text>
                  <TextInput
                    style={[styles.renameInput, { borderColor: themeColorWithAlpha(themeColor, '30') }]}
                    value={renameDraft}
                    onChangeText={setRenameDraft}
                    placeholder="Group name"
                    placeholderTextColor={colors.textMuted}
                    editable={!savingName && !deletingGroup}
                    maxLength={80}
                    returnKeyType="done"
                    onSubmitEditing={handleRenameGroup}
                  />
                  <View style={styles.manageActionRow}>
                    <TouchableOpacity
                      style={[
                        styles.renameSaveBtn,
                        styles.manageActionBtn,
                        { backgroundColor: themeColor },
                        (savingName || !renameDraft.trim() || renameDraft.trim() === groupName) && styles.renameSaveBtnDisabled,
                      ]}
                      onPress={handleRenameGroup}
                      disabled={savingName || deletingGroup || !renameDraft.trim() || renameDraft.trim() === groupName}
                    >
                      {savingName ? (
                        <ActivityIndicator size="small" color={colors.textOnPrimary} />
                      ) : (
                        <Text style={styles.renameSaveBtnText}>Save name</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.deleteGroupBtn, styles.manageActionBtn, deletingGroup && styles.deleteGroupBtnDisabled]}
                      onPress={handleDeleteGroup}
                      disabled={deletingGroup || savingName}
                    >
                      {deletingGroup ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <>
                          <Trash2 size={18} color={colors.danger} />
                          <Text style={styles.deleteGroupBtnText}>Delete group</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
                <ScrollView style={styles.manageScroll} contentContainerStyle={styles.manageScrollContent}>
                  <Text style={styles.manageSectionTitle}>In this group</Text>
                {manageMembers.map((m) => (
                  <View key={m.user_id} style={styles.manageRow}>
                    <Avatar uri={m.avatar_url} name={m.full_name} size={40} />
                    <Text style={styles.manageRowName} numberOfLines={1}>{m.full_name}</Text>
                    {m.user_id === user?.id ? (
                      <Text style={styles.manageYou}>You</Text>
                    ) : (
                      <TouchableOpacity onPress={() => removeMemberFromGroup(m.user_id)} style={styles.manageRemoveBtn}>
                        <UserMinus size={20} color="#dc2626" />
                        <Text style={styles.manageRemoveText}>Remove</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <Text style={[styles.manageSectionTitle, { marginTop: 20 }]}>Add from event</Text>
                {addableMembers.length === 0 ? (
                  <Text style={styles.manageHint}>Everyone in the event is already in this group.</Text>
                ) : (
                  addableMembers.map((m) => (
                    <View key={m.user_id} style={styles.manageRow}>
                      <Avatar uri={m.avatar_url} name={m.full_name} size={40} />
                      <Text style={styles.manageRowName} numberOfLines={1}>{m.full_name}</Text>
                      <TouchableOpacity onPress={() => addMemberToGroup(m.user_id)} style={styles.manageAddBtn}>
                        <UserPlus size={20} color={themeColor} />
                        <Text style={[styles.manageAddText, { color: themeColor }]}>Add</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 52 : 0}
      >
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>No messages yet. Say something!</Text>
            </View>
          }
        />
        {imageUri ? (
          <View style={styles.previewRow}>
            <Image source={{ uri: imageUri }} style={styles.previewThumb} resizeMode="cover" />
            <TouchableOpacity onPress={() => setImageUri(null)} style={styles.removePreviewBtn}>
              <Text style={[styles.removePreviewText, { color: themeColor }]}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <TouchableOpacity onPress={handlePickImage} disabled={sending} style={styles.attachButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ImageIcon size={24} color={themeColor} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Message…"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={2000}
            editable={!sending}
          />
          <TouchableOpacity
            style={[styles.sendButton, { backgroundColor: themeColor }, !canSend && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!canSend}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <Send size={22} color={colors.textOnPrimary} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  list: { padding: 16, paddingBottom: 8 },
  placeholder: { paddingVertical: 32, alignItems: 'center' },
  placeholderText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  bubbleWrap: { marginBottom: 8 },
  bubbleWrapMe: { alignItems: 'flex-end' },
  bubbleWrapThem: { alignItems: 'flex-start' },
  senderName: { fontSize: 12, color: colors.textMuted, marginBottom: 2, marginLeft: 4 },
  bubble: {
    maxWidth: '80%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderBottomRightRadius: 4,
  },
  bubbleMe: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 4,
  },
  bubbleThem: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 16, color: colors.text },
  bubbleTextMe: { color: colors.textOnPrimary },
  time: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  timeMe: { color: 'rgba(255,255,255,0.8)' },
  attachmentWrap: { marginBottom: 4, borderRadius: 12, overflow: 'hidden', maxWidth: 240, maxHeight: 240 },
  attachmentImage: { width: 240, height: 240 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  previewThumb: { width: 56, height: 56, borderRadius: 8 },
  removePreviewBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  removePreviewText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  expandedImage: { width: '100%', height: '80%' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 24,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  attachButton: { padding: 10, justifyContent: 'center', alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingTop: 10,
    fontSize: 16,
    color: colors.text,
    maxHeight: 120,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { opacity: 0.5 },
  manageModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  manageModal: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' },
  manageModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  manageModalTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  manageModalClose: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  manageTopPanel: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  manageActionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  manageActionBtn: { flex: 1, marginBottom: 0 },
  manageScroll: { maxHeight: 360 },
  manageScrollContent: { padding: 16, paddingBottom: 24 },
  manageSectionTitle: { fontSize: 14, fontWeight: '600', color: colors.textMuted, marginBottom: 12 },
  manageRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  manageRowName: { flex: 1, fontSize: 16, color: colors.text },
  manageYou: { fontSize: 13, color: colors.textMuted },
  manageRemoveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  manageRemoveText: { fontSize: 14, color: '#dc2626', fontWeight: '500' },
  manageAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  manageAddText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  manageHint: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  renameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
    marginBottom: 10,
  },
  renameSaveBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  renameSaveBtnDisabled: { opacity: 0.5 },
  renameSaveBtnText: { fontSize: 15, fontWeight: '600', color: colors.textOnPrimary },
  deleteGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: '#fef2f2',
    minHeight: 46,
  },
  deleteGroupBtnDisabled: { opacity: 0.6 },
  deleteGroupBtnText: { fontSize: 15, fontWeight: '600', color: colors.danger },
});
