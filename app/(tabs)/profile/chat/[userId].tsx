import { useEffect, useState, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { Send, ChevronLeft } from 'lucide-react-native';
import { useAuthStore } from '../../../../stores/authStore';
import { useEventStore } from '../../../../stores/eventStore';
import { supabase } from '../../../../lib/supabase';
import { colors } from '../../../../constants/colors';
import { format } from 'date-fns';

type MessageRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
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
  const [sending, setSending] = useState(false);
  const [otherName, setOtherName] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  const fetchOtherUser = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('users').select('full_name, avatar_url').eq('id', userId).single();
    if (data) setOtherName((data as { full_name: string }).full_name ?? '');
  }, [userId]);

  const fetchMessages = useCallback(async () => {
    if (!user?.id || !userId || !currentEvent?.id) {
      setMessages([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id, sender_id, receiver_id, content, is_read, created_at')
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
    } catch (err) {
      console.error('Messages fetch error:', err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, userId, currentEvent?.id]);

  useEffect(() => {
    if (from) {
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
    fetchOtherUser();
  }, [fetchOtherUser]);

  const checkConnection = useCallback(async () => {
    if (!user?.id || !userId || !currentEvent?.id) {
      setIsConnected(null);
      setLoading(false);
      return;
    }
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
  }, [user?.id, userId, currentEvent?.id]);

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
        () => fetchMessages()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent?.id, user?.id, userId, fetchMessages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !user?.id || !userId || !currentEvent?.id) return;
    setSending(true);
    setInput('');
    try {
      const { error } = await supabase.from('messages').insert({
        event_id: currentEvent.id,
        sender_id: user.id,
        receiver_id: userId,
        content: text,
      });
      if (error) throw error;
      await fetchMessages();
    } catch (err) {
      console.error('Send message error:', err);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }: { item: MessageRow }) => {
    const isMe = item.sender_id === user?.id;
    return (
      <View style={[styles.bubbleWrap, isMe ? styles.bubbleWrapMe : styles.bubbleWrapThem]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
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

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
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
        <View style={styles.inputRow}>
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
            style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!input.trim() || sending}
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
});
