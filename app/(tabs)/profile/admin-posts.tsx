import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';
import { Pin, Eye, EyeOff, Trash2 } from 'lucide-react-native';

type PostRow = { id: string; image_url: string; caption: string | null; is_pinned: boolean; is_approved: boolean; created_at: string; user?: { full_name: string } };

export default function AdminPostsScreen() {
  const { currentEvent } = useEventStore();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchPosts = async () => {
    if (!currentEvent?.id) {
      setPosts([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('posts')
        .select('id, image_url, caption, is_pinned, is_approved, created_at, user:users(full_name)')
        .eq('event_id', currentEvent.id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setPosts((data ?? []) as unknown as PostRow[]);
    } catch (err) {
      console.error(err);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [currentEvent?.id]);

  useFocusEffect(
    useCallback(() => {
      if (currentEvent?.id) fetchPosts().catch(() => {});
    }, [currentEvent?.id])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPosts();
    setRefreshing(false);
  };

  const togglePin = async (post: PostRow) => {
    if (!currentEvent?.id || updatingId) return;
    setUpdatingId(post.id);
    try {
      await supabase.from('posts').update({ is_pinned: !post.is_pinned }).eq('id', post.id);
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, is_pinned: !p.is_pinned } : p)));
    } catch (err) {
      Alert.alert('Error', 'Failed to update.');
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleApproved = async (post: PostRow) => {
    if (!currentEvent?.id || updatingId) return;
    setUpdatingId(post.id);
    try {
      await supabase.from('posts').update({ is_approved: !post.is_approved }).eq('id', post.id);
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, is_approved: !p.is_approved } : p)));
    } catch (err) {
      Alert.alert('Error', 'Failed to update.');
    } finally {
      setUpdatingId(null);
    }
  };

  const deletePost = (post: PostRow) => {
    Alert.alert(
      'Delete post?',
      'This will remove the post from the feed. You can\'t undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!currentEvent?.id || updatingId) return;
            setUpdatingId(post.id);
            try {
              const { error } = await supabase.from('posts').update({ is_deleted: true }).eq('id', post.id);
              if (error) throw error;
              setPosts((prev) => prev.filter((p) => p.id !== post.id));
            } catch (err) {
              Alert.alert('Error', 'Failed to delete post.');
            } finally {
              setUpdatingId(null);
            }
          },
        },
      ]
    );
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}><Text style={styles.subtitle}>Select an event first.</Text></View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Image source={{ uri: item.image_url }} style={styles.thumb} />
            <View style={styles.body}>
              <Text style={styles.caption} numberOfLines={2}>{item.caption || 'No caption'}</Text>
              <Text style={styles.meta}>{(item.user as any)?.full_name ?? '—'} · {new Date(item.created_at).toLocaleDateString()}</Text>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => togglePin(item)} disabled={updatingId === item.id}>
                  <Pin size={18} color={item.is_pinned ? colors.primary : colors.textMuted} fill={item.is_pinned ? colors.primary : 'transparent'} />
                  <Text style={styles.actionText}>{item.is_pinned ? 'Pinned' : 'Pin'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => toggleApproved(item)} disabled={updatingId === item.id}>
                  {item.is_approved ? <EyeOff size={18} color={colors.textMuted} /> : <Eye size={18} color={colors.primary} />}
                  <Text style={styles.actionText}>{item.is_approved ? 'Hide' : 'Approve'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.deleteAction]} onPress={() => deletePost(item)} disabled={updatingId === item.id}>
                  <Trash2 size={18} color={colors.danger} />
                  <Text style={styles.deleteActionText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, paddingBottom: 32 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 14, color: colors.textSecondary },
  row: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 12, backgroundColor: colors.surface, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: colors.border },
  body: { flex: 1, marginLeft: 12 },
  caption: { fontSize: 14, color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  actions: { flexDirection: 'row', marginTop: 8, gap: 16 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { fontSize: 13, color: colors.textSecondary },
  deleteAction: {},
  deleteActionText: { fontSize: 13, color: colors.danger },
});
