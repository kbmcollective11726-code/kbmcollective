import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { supabase } from '../../../lib/supabase';
import { colors, notificationIcons } from '../../../constants/colors';
import { format } from 'date-fns';

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
};

export default function NotificationsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { user } = useAuthStore();

  useEffect(() => {
    if (from && typeof from === 'string') {
      const returnPath = decodeURIComponent(from);
      navigation.setOptions({
        headerBackVisible: false,
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => router.replace(returnPath as any)}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
        ),
      });
    }
  }, [from, navigation, router]);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, is_read, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setItems((data ?? []) as NotificationRow[]);
    } catch (err) {
      console.error('Notifications fetch error:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchNotifications();
    setRefreshing(false);
  };

  const markAsRead = async (id: string) => {
    if (!user?.id) return;
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', user.id);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch (err) {
      console.error('Mark read error:', err);
    }
  };

  const renderItem = ({ item }: { item: NotificationRow }) => (
    <TouchableOpacity
      style={[styles.row, !item.is_read && styles.rowUnread]}
      onPress={() => markAsRead(item.id)}
      activeOpacity={0.7}
    >
      <Text style={styles.icon}>{notificationIcons[item.type] ?? 'ℹ️'}</Text>
      <View style={styles.body}>
        <Text style={[styles.title, !item.is_read && styles.titleUnread]} numberOfLines={1}>
          {item.title}
        </Text>
        {item.body ? (
          <Text style={styles.bodyText} numberOfLines={2}>
            {item.body}
          </Text>
        ) : null}
        <Text style={styles.time}>{format(new Date(item.created_at), 'MMM d, h:mm a')}</Text>
      </View>
    </TouchableOpacity>
  );

  if (!user) return null;

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.placeholderText}>Loading notifications…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>No notifications yet.</Text>
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
  backButton: { marginLeft: 8, padding: 4 },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  placeholderText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowUnread: {
    backgroundColor: colors.primaryFaded,
    borderColor: colors.primary,
  },
  icon: {
    fontSize: 24,
    marginRight: 12,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  titleUnread: {
    fontWeight: '600',
  },
  bodyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  time: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
  },
});
