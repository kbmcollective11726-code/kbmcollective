import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { Send, ChevronLeft, ImageIcon } from 'lucide-react-native';
import { useAuthStore } from '../../../../stores/authStore';
import { useEventStore } from '../../../../stores/eventStore';
import { supabase, withRetryAndRefresh } from '../../../../lib/supabase';
import { createNotificationAndPush } from '../../../../lib/notifications';
import { pickImage } from '../../../../lib/image';
import { uploadImage } from '../../../../lib/image';
import { colors } from '../../../../constants/colors';
import { format } from 'date-fns';

type MessageRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
};

export default function ChatScreen() {
  const params = useLocalSearchParams<{ userId: string; from?: string }>();
  const userId = typeof params.userId === 'string' ? params.userId : params.userId?.[0] ?? '';
  const from = typeof params.from === 'string' ? params.from : params.from?.[0];
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [otherName, setOtherName] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);

  const fetchOtherUser = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase.from('users').select('full_name, avatar_url').eq('id', userId).single();
      if (!error && data) setOtherName((data as { full_name: string }).full_name ?? '');
    } catch {
      // leave otherName as-is on error
    }
  }, [userId]);

  const fetchMessages = useCallback(async () => {
    if (!user?.id || !userId || !currentEvent?.id) {
      setMessages([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    setFetchError(null);
    try {
      await withRetryAndRefresh(async () => {
        const { data, error } = await supabase
          .from('messages')
          .select('id, sender_id, receiver_id, content, is_read, created_at, attachment_url, attachment_type')
          .eq('event_id', currentEvent.id)
          .or(`and(sender_id.eq.${user.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${user.id})`)
          .order('created_at', { ascending: true });

        if (error) throw error;
        setMessages((data ?? []) as MessageRow[]);

        await supabase
          .from('messages')
          .update({ is_read: true })
          .eq('event_id', currentEvent.id)
          .eq('receiver_id', user.id)
          .eq('sender_id', userId);
      });
    } catch (err) {
      if (__DEV__) console.warn('Messages fetch error:', err);
      setMessages([]);
      setFetchError('Error - page not loading');
    } finally {
      setLoading(false);
    }
  }, [user?.id, userId, currentEvent?.id]);

  const goBack = useCallback(() => {
    const returnPath = from && typeof from === 'string' ? decodeURIComponent(from).trim() : null;
    if (returnPath) {
      router.replace(returnPath as any);
    } else {
      router.back();
    }
  }, [from, router]);

  useEffect(() => {
    if (from && typeof from === 'string') {
      navigation.setOptions({
        headerBackVisible: false,
        headerLeft: () => (
          <TouchableOpacity
            onPress={goBack}
            style={{ padding: 8, marginLeft: 4 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
        ),
      });
    }
  }, [from, goBack, navigation]);

  useEffect(() => {
    fetchOtherUser().catch(() => {});
  }, [fetchOtherUser]);

  useFocusEffect(
    useCallback(() => {
      if (user?.id && userId && currentEvent?.id) {
        fetchOtherUser().catch(() => {});
        fetchMessages().catch(() => {});
      }
    }, [user?.id, userId, currentEvent?.id, fetchOtherUser, fetchMessages])
  );

  const checkConnection = useCallback(async () => {
    if (!user?.id || !userId || !currentEvent?.id) {
      setIsConnected(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await supabase
        .from('connections')
        .select('id')
        .eq('event_id', currentEvent.id)
        .eq('user_id', user.id)
        .eq('connected_user_id', userId)
        .maybeSingle();
      const connected = !!data;
      setIsConnected(connected);
      if (!connected) setLoading(false);
    } catch {
      setIsConnected(false);
      setLoading(false);
      setFetchError('Error - page not loading');
    }
  }, [user?.id, userId, currentEvent?.id]);

  // Like Info: run and wait. No timeout so first try can complete.
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    if (isConnected !== true) return;
    fetchMessages();
  }, [isConnected, fetchMessages]);

  useEffect(() => {
    if (!currentEvent?.id || !user?.id || !userId) return;
    const channel = supabase
      .channel(`messages:${currentEvent.id}:${user.id}:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `event_id=eq.${currentEvent.id}`,
        },
        () => { fetchMessages().catch(() => {}); }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent?.id, user?.id, userId, fetchMessages]);

  const sendMessage = async () => {
    const text = input.trim();
    const hasImage = !!imageUri;
    if ((!text && !hasImage) || !user?.id || !userId || !currentEvent?.id) return;
    setSending(true);
    setInput('');
    const imageToSend = imageUri;
    setImageUri(null);
    try {
      let attachmentUrl: string | null = null;
      if (imageToSend) {
        const url = await uploadImage(imageToSend, currentEvent.id, user.id, 'event-photos', { folder: 'chat' });
        attachmentUrl = url;
      }
      const { error } = await supabase.from('messages').insert({
        event_id: currentEvent.id,
        sender_id: user.id,
        receiver_id: userId,
        content: text || '',
        attachment_url: attachmentUrl,
        attachment_type: attachmentUrl ? 'image' : null,
      });
      if (error) throw error;
      const senderName = user.full_name ?? 'Someone';
      const notifTitle = `New message from ${senderName}`;
      const notifBody = attachmentUrl && !text ? 'Sent a photo' : (text || '').slice(0, 100);
      await createNotificationAndPush(
        userId,
        currentEvent.id,
        'message',
        notifTitle,
        notifBody || null,
        { chat_user_id: user.id }
      );
      await fetchMessages();
    } catch (err) {
      console.error('Send message error:', err);
      setInput(text);
      setImageUri(imageToSend || null);
      Alert.alert('Send failed', err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  const handlePickImage = async () => {
    const uri = await pickImage('library');
    if (uri) setImageUri(uri);
  };

  const renderItem = ({ item }: { item: MessageRow }) => {
    const isMe = item.sender_id === user?.id;
    const hasAttachment = !!item.attachment_url;
    const contentTrimmed = (item.content || '').trim();
    return (
      <View style={[styles.bubbleWrap, isMe ? styles.bubbleWrapMe : styles.bubbleWrapThem]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          {hasAttachment ? (
            <TouchableOpacity
              onPress={() => setExpandedImageUrl(item.attachment_url!)}
              activeOpacity={0.9}
              style={styles.attachmentWrap}
            >
              <Image source={{ uri: item.attachment_url! }} style={styles.attachmentImage} resizeMode="cover" />
            </TouchableOpacity>
          ) : null}
          {contentTrimmed !== '' && contentTrimmed !== ' ' ? (
            <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
          ) : null}
          <Text style={[styles.time, isMe && styles.timeMe]}>{format(new Date(item.created_at), 'h:mm a')}</Text>
        </View>
      </View>
    );
  };

  if (!userId || !user?.id || !currentEvent?.id) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Select an event and open a chat from Community.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isConnected === null || loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.placeholderText}>Loading chat…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isConnected === false) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Connect with {otherName || 'this user'} first to message.</Text>
          <TouchableOpacity
            style={styles.connectFirstButton}
            onPress={() => router.replace(`/feed/user/${userId}` as any)}
          >
            <Text style={styles.connectFirstButtonText}>View profile & connect</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Error - page not loading</Text>
          <Text style={styles.errorSubtext}>Tap Try again or check your connection.</Text>
          <TouchableOpacity
            onPress={() => {
              setFetchError(null);
              setLoading(true);
              fetchMessages();
            }}
            style={styles.retryBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const canSend = (input.trim() || imageUri) && !sending;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Modal visible={!!expandedImageUrl} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setExpandedImageUrl(null)}>
          {expandedImageUrl ? (
            <Image source={{ uri: expandedImageUrl }} style={styles.expandedImage} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>No messages yet. Say hi!</Text>
            </View>
          }
        />
        {imageUri ? (
          <View style={styles.previewRow}>
            <Image source={{ uri: imageUri }} style={styles.previewThumb} resizeMode="cover" />
            <TouchableOpacity onPress={() => setImageUri(null)} style={styles.removePreviewBtn}>
              <Text style={styles.removePreviewText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <TouchableOpacity
            onPress={handlePickImage}
            disabled={sending}
            style={styles.attachButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ImageIcon size={24} color={colors.primary} />
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
            style={[styles.sendButton, (!canSend) && styles.sendButtonDisabled]}
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  list: {
    padding: 16,
    paddingBottom: 8,
  },
  placeholder: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorSubtext: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  retryBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  retryBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  connectFirstButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: colors.primary,
    borderRadius: 12,
  },
  connectFirstButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  bubbleWrap: {
    marginBottom: 8,
  },
  bubbleWrapMe: {
    alignItems: 'flex-end',
  },
  bubbleWrapThem: {
    alignItems: 'flex-start',
  },
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
  bubbleText: {
    fontSize: 16,
    color: colors.text,
  },
  bubbleTextMe: {
    color: colors.textOnPrimary,
  },
  time: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  timeMe: {
    color: 'rgba(255,255,255,0.8)',
  },
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
  sendButtonDisabled: {
    opacity: 0.5,
  },
  attachButton: {
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentWrap: {
    marginBottom: 4,
    borderRadius: 12,
    overflow: 'hidden',
    maxWidth: 240,
    maxHeight: 240,
  },
  attachmentImage: {
    width: 240,
    height: 240,
  },
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
  previewThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  removePreviewBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  removePreviewText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  expandedImage: {
    width: '100%',
    height: '80%',
  },
});
