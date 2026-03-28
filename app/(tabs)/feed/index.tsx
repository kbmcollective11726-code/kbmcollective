import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  FlatList,
  RefreshControl,
  Modal,
  TouchableOpacity,
  Pressable,
  Dimensions,
  Alert,
  ActivityIndicator,
  AppState,
  AppStateStatus,
} from 'react-native';
import { X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { useBlockStore } from '../../../stores/blockStore';
import { supabase, isSupabaseConfigured, withRetryAndRefresh, refreshSessionIfNeeded, getErrorMessage } from '../../../lib/supabase';
import { addDebugLog } from '../../../lib/debugLog';
import { awardPoints } from '../../../lib/points';
import { createNotificationAndPush } from '../../../lib/notifications';
import { withRefreshTimeout } from '../../../lib/refreshWithTimeout';
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
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const [expandedImagePost, setExpandedImagePost] = useState<Post | null>(null);
  const [likingPostId, setLikingPostId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const fetchPostsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const fetchPosts = useCallback(async () => {
    const eventId = useEventStore.getState().currentEvent?.id;
    if (!eventId || !user?.id) {
      setPosts([]);
      setLoading(false);
      setFetchError(null);
      return;
    }
    setFetchError(null);
    try {
      await withRetryAndRefresh(async () => {
        const { data: postsData, error } = await supabase
          .from('posts')
          .select('id, event_id, user_id, image_url, caption, image_hash, likes_count, comments_count, is_pinned, is_approved, is_deleted, created_at, user:users(id, full_name, avatar_url)')
          .eq('event_id', eventId)
          .eq('is_deleted', false)
          .eq('is_approved', true)
          .order('is_pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(30);

        if (error) throw error;

        const raw = postsData ?? [];
        const normalized: Post[] = raw.map((p: Record<string, unknown>) => ({
          ...p,
          user: Array.isArray(p.user) ? (p.user[0] ?? null) : p.user,
        })) as Post[];

        const postIds = normalized.map((p) => p.id);
        let likedSet = new Set<string>();
        if (postIds.length > 0) {
          const { data: likesData, error: likesError } = await supabase
            .from('likes')
            .select('post_id')
            .eq('user_id', user.id)
            .in('post_id', postIds);
          if (!likesError) {
            likedSet = new Set((likesData ?? []).map((l: { post_id: string }) => l.post_id));
          }
        }

        const filtered = normalized.filter((p) => !isBlocked(p.user_id));
        const withLiked = filtered.map((p) => ({
          ...p,
          user_liked: likedSet.has(p.id),
        }));
        setPosts(withLiked);
      });
      setFetchError(null);
    } catch (err: unknown) {
      const msg = getErrorMessage(err) || 'Error - page not loading';
      addDebugLog('Feed', 'Load failed', msg);
      if (__DEV__) console.warn('Feed fetch error:', err);
      setPosts([]);
      setFetchError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, blockedUserIds]);
  fetchPostsRef.current = fetchPosts;

  useEffect(() => {
    if (user?.id) fetchBlockedUsers(user.id);
  }, [user?.id]);

  // Like Info: run and wait. No timer so first try can complete.
  useEffect(() => {
    if (!currentEvent?.id || !user?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchPostsRef.current()
      .catch(() => { if (!cancelled) setTimeout(() => fetchPostsRef.current().finally(() => {}), 2000); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentEvent?.id, user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (currentEvent?.id && user?.id) fetchPostsRef.current().catch(() => {});
    }, [currentEvent?.id, user?.id])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && currentEvent?.id && user?.id) {
        refreshSessionIfNeeded()
          .catch(() => {})
          .finally(() => fetchPostsRef.current().catch(() => {}));
      }
    });
    return () => sub.remove();
  }, [currentEvent?.id, user?.id]);

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

  useEffect(() => {
    if (!currentEvent?.id) return;
    const channel = supabase
      .channel('feed-posts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts', filter: `event_id=eq.${currentEvent.id}` },
        () => { fetchPosts().catch(() => {}); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'likes' },
        () => { fetchPosts().catch(() => {}); }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent?.id, fetchPosts]);

  const handleLike = async (post: Post) => {
    if (!user?.id || !currentEvent?.id) return;
    if (post.user_id === user.id) return;
    if (likingPostId === post.id) return;
    setLikingPostId(post.id);

    // Optimistic: update user_liked and likes_count so the UI updates immediately.
    const wasLiked = post.user_liked;
    const currentCount = post.likes_count ?? 0;
    const nextCount = wasLiked ? Math.max(0, currentCount - 1) : currentCount + 1;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id ? { ...p, user_liked: !wasLiked, likes_count: nextCount } : p
      )
    );

    try {
      if (wasLiked) {
        await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', user.id);
      } else {
        const { data: likeRow, error: insertError } = await supabase
          .from('likes')
          .insert({ post_id: post.id, user_id: user.id })
          .select('id')
          .single();

        if (insertError?.code === '23505') {
          // Already liked (e.g. from another device). Rollback optimistic update.
          setPosts((prev) =>
            prev.map((p) =>
              p.id === post.id ? { ...p, user_liked: wasLiked, likes_count: post.likes_count ?? 0 } : p
            )
          );
          setLikingPostId(null);
          return;
        }
        if (insertError) throw insertError;

        await awardPoints(user.id, currentEvent.id, 'give_like', post.id);
        if (post.user_id && likeRow?.id) {
          await awardPoints(post.user_id, currentEvent.id, 'receive_like', likeRow.id);
        }
        await createNotificationAndPush(
          post.user_id,
          currentEvent.id,
          'like',
          `${user.full_name ?? 'Someone'} liked your post`,
          null,
          { post_id: post.id }
        );
      }
      // Refetch to get correct likes_count from DB (trigger-updated)
      await fetchPosts();
    } catch (err) {
      console.error('Like error:', err);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, user_liked: wasLiked, likes_count: post.likes_count ?? 0 } : p
        )
      );
    } finally {
      setLikingPostId(null);
    }
  };

  const handleComment = (post: Post) => {
    setCommentPost(post);
  };

  const handleDeleteOwnPost = (post: Post) => {
    if (!user?.id) {
      Alert.alert('Error', 'Please sign in again and try deleting.');
      return;
    }
    Alert.alert(
      'Delete photo?',
      'This will remove your post from the feed. You can\'t undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase.rpc('delete_own_post', { post_id: post.id });
              if (error) {
                const fnMissing = /function.*does not exist|delete_own_post/i.test(error.message);
                if (fnMissing) {
                  const { data: updateData, error: updateError } = await supabase
                    .from('posts')
                    .update({ is_deleted: true })
                    .eq('id', post.id)
                    .eq('user_id', user.id)
                    .select('id')
                    .maybeSingle();
                  if (updateError) throw updateError;
                  if (!updateData) {
                    Alert.alert('Error', 'Could not delete post. Add delete_own_post in Supabase: see supabase-schema.sql and run that function in SQL Editor.');
                    return;
                  }
                } else throw error;
              } else if (data === false) {
                Alert.alert('Error', 'Could not delete post. You can only delete your own posts.');
                return;
              }
              setPosts((prev) => prev.filter((p) => p.id !== post.id));
              if (commentPost?.id === post.id) setCommentPost(null);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              Alert.alert('Error', msg.includes('row-level security') || msg.includes('policy')
                ? 'You can only delete your own posts.'
                : `Could not delete post. ${msg}`);
            }
          },
        },
      ]
    );
  };

  const FEED_TIMEOUT_MS = 45000;
  const SESSION_REFRESH_MS = 5000;

  const loadFeedWithRetry = useCallback(async () => {
    setFetchError(null);
    try {
      await withRefreshTimeout(supabase.auth.refreshSession(), SESSION_REFRESH_MS);
    } catch {
      // Continue anyway; fetch may still work
    }
    try {
      await withRefreshTimeout(fetchPosts(), FEED_TIMEOUT_MS);
      return;
    } catch {
      // First attempt timed out; retry once with a fresh session
      try {
        await withRefreshTimeout(supabase.auth.refreshSession(), SESSION_REFRESH_MS);
      } catch {
        // ignore
      }
      try {
        await withRefreshTimeout(fetchPosts(), FEED_TIMEOUT_MS);
      } catch {
        setFetchError('Request timed out. Pull down to retry or tap Try again.');
      }
    }
  }, [fetchPosts]);

  const onRefresh = async () => {
    setRefreshing(true);
    addDebugLog('Feed', 'Pull-to-refresh started');
    try {
      await loadFeedWithRetry();
      addDebugLog('Feed', 'Pull-to-refresh finished');
    } catch (e) {
      addDebugLog('Feed', 'Pull-to-refresh failed', getErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
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

  // Always show Feed layout (header + list) so the tab "loads" immediately; loading/error live in the empty state.
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
            {loading ? (
              <>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.placeholderTitle}>Loading feed…</Text>
                <Text style={styles.subtitle}>Fetching the latest posts</Text>
              </>
            ) : fetchError ? (
              <>
                <Text style={styles.placeholderTitle}>Couldn't load the feed</Text>
                <Text style={styles.subtitle}>{fetchError}</Text>
                {!isSupabaseConfigured && (
                  <Text style={[styles.subtitle, { marginTop: 8, fontStyle: 'italic' }]}>
                    Supabase may not be configured. Restart with: npx expo start --clear
                  </Text>
                )}
                {Constants.appOwnership === 'expo' && isSupabaseConfigured && (
                  <Text style={[styles.subtitle, { marginTop: 8, fontStyle: 'italic', fontSize: 12 }]}>
                    Expo Go: Run npx expo start --clear from project root. Same Wi‑Fi or use --tunnel.
                  </Text>
                )}
                <Pressable
                  onPress={async () => {
                    setFetchError(null);
                    setLoading(true);
                    await loadFeedWithRetry();
                    setLoading(false);
                  }}
                  style={({ pressed }) => [
                    styles.retryButton,
                    pressed && styles.retryButtonPressed,
                  ]}
                >
                  <Text style={styles.retryButtonText}>Try again</Text>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.placeholderIconWrap}>
                  <Camera size={48} color={colors.primary} strokeWidth={1.5} />
                </View>
                <Text style={styles.placeholderTitle}>No posts yet</Text>
                <Text style={styles.subtitle}>Be the first to share a photo from this event!</Text>
              </>
            )}
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
            onPressImage={() => setExpandedImagePost(item)}
            isOwnPost={item.user_id === user?.id}
            onDelete={item.user_id === user?.id ? () => handleDeleteOwnPost(item) : undefined}
            likeDisabled={likingPostId === item.id}
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
      <Modal
        visible={!!expandedImagePost}
        transparent
        animationType="fade"
        onRequestClose={() => setExpandedImagePost(null)}
      >
        <Pressable
          style={styles.imageModalOverlay}
          onPress={() => setExpandedImagePost(null)}
        >
          <View style={styles.imageModalContent}>
            <TouchableOpacity
              style={styles.imageModalClose}
              onPress={() => setExpandedImagePost(null)}
              hitSlop={16}
            >
              <X size={28} color="#fff" />
            </TouchableOpacity>
            {expandedImagePost && (
              <Image
                source={{ uri: expandedImagePost.image_url }}
                style={styles.imageModalImage}
                resizeMode="contain"
              />
            )}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  list: {
    paddingHorizontal: 0,
    paddingTop: 16,
    paddingBottom: 32,
  },
  imageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageModalContent: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageModalClose: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  imageModalImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.7,
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
  retryButton: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  retryButtonPressed: {
    opacity: 0.85,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
