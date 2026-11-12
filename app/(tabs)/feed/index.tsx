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
  useWindowDimensions,
  Platform,
} from 'react-native';
import { X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useFocusEffect } from "@react-navigation/native";
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { useBlockStore } from '../../../stores/blockStore';
import { supabase, isSupabaseConfigured, withRetryAndRefresh, getErrorMessage } from '../../../lib/supabase';
import { addDebugLog } from '../../../lib/debugLog';
import { awardPoints } from '../../../lib/points';
import { createNotificationAndPush } from '../../../lib/notifications';
import { withRefreshTimeout } from '../../../lib/refreshWithTimeout';
import { registerRefetchOnSessionRefreshed } from '../../../lib/onSessionRefreshed';
import { chunkIds } from '../../../lib/supabaseSelectAllPages';
import {
  getRecentFeedPosts,
  mergeRecentFeedPosts,
  removeRecentFeedPost,
  subscribeToRecentFeedPosts,
} from '../../../lib/recentFeedPosts';
import { loadCachedFeed, saveCachedFeed } from '../../../lib/eventOfflineCache';
import type { Post } from '../../../lib/types';
import { useResolvedEventSponsors } from '../../../lib/useResolvedEventSponsors';
import { Camera } from 'lucide-react-native';
import { colors } from '../../../constants/colors';
import { themeColorWithAlpha, useEventThemeColor } from '../../../lib/eventTheme';
import PostCard from '../../../components/PostCard';
import CommentSheet from '../../../components/CommentSheet';
import CompactSponsorStrip from '../../../components/CompactSponsorStrip';
import EmptyState from '../../../components/ui/EmptyState';

const FEED_PAGE_SIZE = 25;
/** Skip network refetch on tab focus if we fetched this recently and already have posts. */
const FEED_FOCUS_TTL_MS = 20_000;

export default function FeedScreen() {
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const blockedUserIds = useBlockStore((s) => s.blockedUserIds);
  const { fetchBlockedUsers, isBlocked } = useBlockStore();
  const router = useRouter();
  const themeColor = useEventThemeColor();
  const themeFaded = themeColorWithAlpha(themeColor, '18');
  const { width: winW } = useWindowDimensions();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const [expandedImagePost, setExpandedImagePost] = useState<Post | null>(null);
  const [likingPostId, setLikingPostId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const { sponsors: feedSponsors, loading: sponsorsLoading, reload: reloadFeedSponsors } = useResolvedEventSponsors(
    currentEvent?.id,
    'feed',
    currentEvent?.reminder_timezone
  );
  /** Reserve strip height while sponsors load so posts don't jump when the banner appears. */
  const sponsorReserveHeight = 14 + 18 + 10 + Math.min(104, Math.max(56, Math.round(winW / 3.6))) + 20;
  const fetchPostsRef = useRef<(opts?: { append?: boolean }) => Promise<void>>(async () => {});
  const postsLengthRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const fetchInProgressRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const lastFetchedAtRef = useRef(0);
  const hydratedEventRef = useRef<string | null>(null);
  postsLengthRef.current = posts.length;
  hasMoreRef.current = hasMore;

  const attachLikedFlags = async (normalized: Post[], userId: string): Promise<Post[]> => {
    const postIds = normalized.map((p) => p.id);
    const likedSet = new Set<string>();
    const LIKES_IN_CHUNK = 120;
    if (postIds.length > 0) {
      for (const idChunk of chunkIds(postIds, LIKES_IN_CHUNK)) {
        const { data: likesData, error: likesError } = await supabase
          .from('likes')
          .select('post_id')
          .eq('user_id', userId)
          .in('post_id', idChunk);
        if (!likesError) {
          for (const row of likesData ?? []) {
            likedSet.add((row as { post_id: string }).post_id);
          }
        }
      }
    }
    return normalized
      .filter((p) => !isBlocked(p.user_id))
      .map((p) => ({
        ...p,
        user_liked: likedSet.has(p.id),
      }));
  };

  const prependRecentPost = useCallback((post: Post) => {
    if (post.event_id !== currentEvent?.id || isBlocked(post.user_id)) return;
    setPosts((prev) => {
      if (prev.some((existing) => existing.id === post.id)) return prev;
      return [post, ...prev];
    });
    setLoading(false);
    setFetchError(null);
  }, [currentEvent?.id, isBlocked]);

  const fetchAndPrependPost = useCallback(async (postId: string) => {
    const { data, error } = await supabase
      .from('posts')
      .select(
        'id, event_id, user_id, image_url, caption, image_hash, likes_count, comments_count, is_pinned, is_approved, is_deleted, created_at, user:users(id, full_name, avatar_url)'
      )
      .eq('id', postId)
      .eq('is_deleted', false)
      .eq('is_approved', true)
      .maybeSingle();
    if (error || !data) return;
    const raw = data as Record<string, unknown>;
    const post = {
      ...raw,
      user: Array.isArray(raw.user) ? (raw.user[0] ?? null) : raw.user,
      user_liked: false,
    } as Post;
    prependRecentPost(post);
  }, [prependRecentPost]);
  const fetchAndPrependPostRef = useRef(fetchAndPrependPost);
  fetchAndPrependPostRef.current = fetchAndPrependPost;

  const fetchPosts = useCallback(async (opts?: { append?: boolean }) => {
    const append = opts?.append === true;
    const eventId = useEventStore.getState().currentEvent?.id;
    if (!eventId || !user?.id) {
      setPosts([]);
      setHasMore(false);
      hasMoreRef.current = false;
      setLoading(false);
      setFetchError(null);
      return;
    }
    if (!append && fetchInProgressRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    if (append) {
      if (loadingMoreRef.current || !hasMoreRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else {
      fetchInProgressRef.current = true;
      setFetchError(null);
      setHasMore(true);
      hasMoreRef.current = true;
    }
    const from = append ? postsLengthRef.current : 0;
    const to = from + FEED_PAGE_SIZE - 1;
    try {
      await withRetryAndRefresh(async () => {
        const res = await supabase
          .from('posts')
          .select(
            'id, event_id, user_id, image_url, caption, image_hash, likes_count, comments_count, is_pinned, is_approved, is_deleted, created_at, user:users(id, full_name, avatar_url)'
          )
          .eq('event_id', eventId)
          .eq('is_deleted', false)
          .eq('is_approved', true)
          .order('is_pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .range(from, to);
        if (res.error) throw res.error;

        const raw = (res.data ?? []) as Record<string, unknown>[];
        const normalized: Post[] = raw.map((p) => ({
          ...p,
          user: Array.isArray(p.user) ? (p.user[0] ?? null) : p.user,
        })) as Post[];
        const withLiked = await attachLikedFlags(normalized, user.id);
        const more = raw.length >= FEED_PAGE_SIZE;
        setHasMore(more);
        hasMoreRef.current = more;
        if (!append) {
          const merged = mergeRecentFeedPosts(eventId, withLiked);
          setPosts(merged);
          void saveCachedFeed(eventId, user.id, merged);
          lastFetchedAtRef.current = Date.now();
        } else {
          setPosts((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            return [...prev, ...withLiked.filter((p) => !seen.has(p.id))];
          });
        }
      });
      setFetchError(null);
    } catch (err: unknown) {
      const msg = getErrorMessage(err) || 'Error - page not loading';
      addDebugLog('Feed', 'Load failed', msg);
      if (__DEV__) console.warn('Feed fetch error:', err);
      if (!append) {
        if (postsLengthRef.current > 0) {
          // Keep showing what we already have; soft-fail.
          setFetchError(null);
        } else {
          const cached = await loadCachedFeed(eventId, user.id);
          if (cached && cached.length > 0) {
            setPosts(mergeRecentFeedPosts(eventId, cached as Post[]));
            setFetchError(null);
          } else {
            setPosts([]);
            setFetchError(msg);
          }
        }
      }
    } finally {
      if (!append) {
        fetchInProgressRef.current = false;
        if (refreshQueuedRef.current) {
          refreshQueuedRef.current = false;
          setTimeout(() => fetchPostsRef.current().catch(() => {}), 0);
        }
      }
      setLoading(false);
      setRefreshing(false);
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [user?.id, blockedUserIds, isBlocked]);
  fetchPostsRef.current = fetchPosts;

  useEffect(() => {
    if (user?.id) fetchBlockedUsers(user.id);
  }, [user?.id]);

  // Event switch: drop previous event's posts so we don't flash the wrong feed.
  useEffect(() => {
    hydratedEventRef.current = null;
    lastFetchedAtRef.current = 0;
    setPosts([]);
    setHasMore(true);
    hasMoreRef.current = true;
    setLoading(true);
    setFetchError(null);
  }, [currentEvent?.id]);

  useFocusEffect(
    useCallback(() => {
      if (!currentEvent?.id || !user?.id) return;
      const eventId = currentEvent.id;
      const userId = user.id;
      let cancelled = false;

      void (async () => {
        if (hydratedEventRef.current !== eventId) {
          hydratedEventRef.current = eventId;
          lastFetchedAtRef.current = 0;
          if (postsLengthRef.current === 0) {
            const cached = await loadCachedFeed(eventId, userId);
            if (cancelled) return;
            if (cached && cached.length > 0) {
              setPosts(mergeRecentFeedPosts(eventId, cached as Post[]));
              setLoading(false);
              setFetchError(null);
            }
          }
        } else if (postsLengthRef.current === 0) {
          const cached = await loadCachedFeed(eventId, userId);
          if (cancelled) return;
          if (cached && cached.length > 0) {
            setPosts(mergeRecentFeedPosts(eventId, cached as Post[]));
            setLoading(false);
            setFetchError(null);
          }
        }

        if (cancelled) return;
        for (const post of getRecentFeedPosts(eventId)) {
          prependRecentPost(post);
        }

        const freshEnough =
          postsLengthRef.current > 0 &&
          Date.now() - lastFetchedAtRef.current < FEED_FOCUS_TTL_MS;
        if (freshEnough) return;

        await fetchPostsRef.current().catch(() => {});
      })();

      return () => {
        cancelled = true;
      };
    }, [currentEvent?.id, user?.id, prependRecentPost])
  );

  useEffect(() => {
    const unregister = registerRefetchOnSessionRefreshed(() => {
      if (currentEvent?.id && user?.id) fetchPostsRef.current().catch(() => {});
    });
    return unregister;
  }, [currentEvent?.id, user?.id]);

  useEffect(() => subscribeToRecentFeedPosts(prependRecentPost), [prependRecentPost]);

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
      .channel(`feed-posts-${currentEvent.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts', filter: `event_id=eq.${currentEvent.id}` },
        (payload) => {
          // Prepend only — a full refetch would cut the list back to page 1 under a scrolled user.
          const id = (payload.new as { id?: string } | null)?.id;
          if (id) fetchAndPrependPostRef.current(id).catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'posts',
          filter: `event_id=eq.${currentEvent.id}`,
        },
        (payload) => {
          // likes_count is maintained on posts via trigger — event-scoped, avoids global likes fan-out
          const row = payload.new as { id?: string; likes_count?: number } | null;
          if (!row?.id || typeof row.likes_count !== 'number') return;
          const likesCount = row.likes_count;
          setPosts((prev) => {
            const idx = prev.findIndex((p) => p.id === row.id);
            if (idx < 0) return prev;
            const post = prev[idx]!;
            if (post.likes_count === likesCount) return prev;
            const next = [...prev];
            next[idx] = { ...post, likes_count: likesCount };
            return next;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEvent?.id]);

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
      const { data: countRow } = await supabase
        .from('posts')
        .select('likes_count')
        .eq('id', post.id)
        .maybeSingle();
      if (countRow && typeof (countRow as { likes_count?: number }).likes_count === 'number') {
        const likesCount = (countRow as { likes_count: number }).likes_count;
        setPosts((prev) =>
          prev.map((p) => (p.id === post.id ? { ...p, likes_count: likesCount } : p))
        );
      }
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
              removeRecentFeedPost(post.id);
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
      await reloadFeedSponsors();
      addDebugLog('Feed', 'Pull-to-refresh finished');
    } catch (e) {
      addDebugLog('Feed', 'Pull-to-refresh failed', getErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  // Stable per-post handlers so memo(PostCard) can skip cards whose post didn't change.
  const postHandlersRef = useRef({ handleLike, handleComment, handleDeleteOwnPost });
  postHandlersRef.current = { handleLike, handleComment, handleDeleteOwnPost };
  const onLikePost = useCallback((post: Post) => {
    postHandlersRef.current.handleLike(post);
  }, []);
  const onCommentPost = useCallback((post: Post) => {
    postHandlersRef.current.handleComment(post);
  }, []);
  const onDeletePost = useCallback((post: Post) => {
    postHandlersRef.current.handleDeleteOwnPost(post);
  }, []);
  const onPressPostUser = useCallback(
    (userId: string) => {
      router.push(`/(tabs)/feed/user/${userId}?from=${encodeURIComponent('/(tabs)/feed')}` as never);
    },
    [router]
  );
  const renderPost = useCallback(
    ({ item }: { item: Post }) => {
      const own = item.user_id === user?.id;
      return (
        <PostCard
          post={item}
          onLike={onLikePost}
          onComment={onCommentPost}
          onPressUser={onPressPostUser}
          onPressImage={setExpandedImagePost}
          isOwnPost={own}
          onDelete={own ? onDeletePost : undefined}
          likeDisabled={likingPostId === item.id}
        />
      );
    },
    [user?.id, likingPostId, onLikePost, onCommentPost, onDeletePost, onPressPostUser]
  );

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={[]}>
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
    <SafeAreaView style={styles.container} edges={[]}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        onEndReached={() => {
          if (hasMore && !loadingMore && !loading) {
            fetchPostsRef.current({ append: true }).catch(() => {});
          }
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: 16 }}>
              <ActivityIndicator size="small" color={themeColor} />
            </View>
          ) : null
        }
        ListHeaderComponent={
          feedSponsors.length > 0 ? (
            <CompactSponsorStrip
              sponsors={feedSponsors}
              title="Mobile app sponsored by"
              eventId={currentEvent?.id}
              placement="feed"
            />
          ) : sponsorsLoading ? (
            <View style={{ height: sponsorReserveHeight }} accessibilityElementsHidden />
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.placeholder}>
            {loading ? (
              <>
                <ActivityIndicator size="large" color={themeColor} />
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
                    { backgroundColor: themeColor },
                    pressed && styles.retryButtonPressed,
                  ]}
                >
                  <Text style={styles.retryButtonText}>Try again</Text>
                </Pressable>
              </>
            ) : (
              <EmptyState
                title="The feed is quiet"
                subtitle="Be the first to share a photo from this event — your moment might start the buzz."
              />
            )}
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[themeColor]} />
        }
        renderItem={renderPost}
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
    backgroundColor: 'transparent',
  },
  list: {
    paddingHorizontal: 0,
    paddingTop: 8,
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
