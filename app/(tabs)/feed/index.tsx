import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { useBlockStore } from '../../../stores/blockStore';
import { supabase } from '../../../lib/supabase';
import { awardPoints } from '../../../lib/points';
import { createNotification } from '../../../lib/notifications';
import { sendAnnouncementPush } from '../../../lib/pushNotifications';
import type { Post } from '../../../lib/types';
import { Camera } from 'lucide-react-native';
import { colors } from '../../../constants/colors';
import PostCard from '../../../components/PostCard';
import CommentSheet from '../../../components/CommentSheet';

export default function FeedScreen() {
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);
  const { fetchBlockedUsers, isBlocked } = useBlockStore();
  const params = useGlobalSearchParams<{ postId?: string }>();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const deepLinkPostIdHandled = useRef(false);

  const fetchPosts = useCallback(async () => {
    if (!currentEvent?.id || !user?.id) {
      setPosts([]);
      setLoading(false);
      return;
    }
    try {
      const { data: postsData, error } = await supabase
        .from('posts')
        .select('*, user:users(id, full_name, avatar_url)')
        .eq('event_id', currentEvent.id)
        .eq('is_deleted', false)
        .eq('is_approved', true)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const postIds = (postsData ?? []).map((p: Post) => p.id);
      if (postIds.length === 0) {
        setPosts((postsData ?? []).map((p: Post) => ({ ...p, user_liked: false })));
        setLoading(false);
        return;
      }

      const { data: likesData } = await supabase
        .from('likes')
        .select('post_id')
        .eq('user_id', user.id)
        .in('post_id', postIds);

      const likedSet = new Set((likesData ?? []).map((l: { post_id: string }) => l.post_id));
      const filtered = (postsData ?? []).filter((p: Post) => !isBlocked(p.user_id));
      const withLiked = filtered.map((p: Post) => ({
        ...p,
        user_liked: likedSet.has(p.id),
      }));
      setPosts(withLiked);
    } catch (err) {
      console.error('Feed fetch error:', err);
      setPosts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentEvent?.id, user?.id, blockedUserIds]);

  useEffect(() => {
    if (user?.id) fetchBlockedUsers(user.id);
  }, [user?.id]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Deep link: open comment sheet for post when opened via collectivelive://post/<id>
  useEffect(() => {
    const postId = params.postId;
    if (!postId || deepLinkPostIdHandled.current || !currentEvent?.id) return;
    const found = posts.find((p) => p.id === postId);
    if (found) {
      deepLinkPostIdHandled.current = true;
      setCommentPost(found);
      router.setParams({ postId: undefined });
      return;
    }
    if (!loading && posts.length >= 0) {
      supabase
        .from('posts')
        .select('*, user:users(id, full_name, avatar_url)')
        .eq('id', postId)
        .eq('event_id', currentEvent.id)
        .eq('is_deleted', false)
        .single()
        .then(({ data }) => {
          if (data && !deepLinkPostIdHandled.current) {
            deepLinkPostIdHandled.current = true;
            setCommentPost({ ...data, user_liked: false } as Post);
            router.setParams({ postId: undefined });
          }
        });
    }
  }, [params.postId, posts, currentEvent?.id, loading, router]);

  useEffect(() => {
    if (!currentEvent?.id) return;
    const channel = supabase
      .channel('feed-posts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts', filter: `event_id=eq.${currentEvent.id}` },
        () => { fetchPosts(); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'likes' },
        () => { fetchPosts(); }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent?.id, fetchPosts]);

  const handleLike = async (post: Post) => {
    if (!user?.id || !currentEvent?.id) return;
    if (post.user_id === user.id) return;
    try {
      if (post.user_liked) {
        await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', user.id);
      } else {
        const { data: likeRow } = await supabase
          .from('likes')
          .insert({ post_id: post.id, user_id: user.id })
          .select('id')
          .single();
        await awardPoints(user.id, currentEvent.id, 'give_like', post.id);
        if (post.user_id && likeRow?.id) {
          await awardPoints(post.user_id, currentEvent.id, 'receive_like', likeRow.id);
        }
        await createNotification(
          post.user_id,
          currentEvent.id,
          'like',
          `${user.full_name ?? 'Someone'} liked your post`,
          null,
          { post_id: post.id }
        );
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token && post.user_id) {
          sendAnnouncementPush(
            session.access_token,
            currentEvent.id,
            `${user.full_name ?? 'Someone'} liked your post`,
            '',
            [post.user_id]
          ).catch(() => {});
        }
      }
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                likes_count: p.likes_count + (post.user_liked ? -1 : 1),
                user_liked: !post.user_liked,
              }
            : p
        )
      );
    } catch (err) {
      console.error('Like error:', err);
    }
  };

  const handleComment = (post: Post) => {
    setCommentPost(post);
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchPosts();
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholderWrap}>
        <View style={styles.placeholder}>
          <View style={styles.placeholderIconWrap}>
            <Camera size={40} color={colors.textMuted} strokeWidth={1.5} />
          </View>
          <Text style={styles.placeholderTitle}>No event selected</Text>
          <Text style={styles.subtitle}>Select an event on the Info tab to see the feed.</Text>
        </View>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && posts.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholderWrap}>
          <View style={styles.placeholder}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.placeholderTitle}>Loading feed…</Text>
            <Text style={styles.subtitle}>Fetching the latest posts</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={6}
        removeClippedSubviews={true}
        ListEmptyComponent={
          <View style={styles.placeholder}>
            <View style={styles.placeholderIconWrap}>
              <Camera size={48} color={colors.primary} strokeWidth={1.5} />
            </View>
            <Text style={styles.placeholderTitle}>No posts yet</Text>
            <Text style={styles.subtitle}>Be the first to share a photo from this event!</Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onLike={() => handleLike(item)}
            onComment={() => handleComment(item)}
            onPressUser={(userId) => router.push(`/feed/user/${userId}`)}
            isOwnPost={item.user_id === user?.id}
          />
        )}
      />
      <CommentSheet
        visible={!!commentPost}
        onClose={() => setCommentPost(null)}
        post={commentPost}
        eventId={currentEvent?.id ?? null}
        currentUserId={user?.id ?? null}
        currentUserFullName={user?.full_name}
        onCommentAdded={() => {
          if (commentPost) {
            setPosts((prev) =>
              prev.map((p) =>
                p.id === commentPost.id ? { ...p, comments_count: p.comments_count + 1 } : p
              )
            );
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  placeholderWrap: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 280,
  },
  placeholderIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primaryFaded,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  placeholderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
