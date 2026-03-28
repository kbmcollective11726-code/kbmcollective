import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../../stores/authStore';
import { useEventStore } from '../../../../stores/eventStore';
import { useBlockStore } from '../../../../stores/blockStore';
import CommentSheet from '../../../../components/CommentSheet';
import { loadPostForCommentSheet, resolveEventForOpenPost } from '../../../../lib/feedOpenPost';
import type { Post } from '../../../../lib/types';
import { colors } from '../../../../constants/colors';

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return typeof v === 'string' ? v : v[0];
}

/**
 * Dedicated route so like/comment notifications always receive postId in the URL path
 * (query params + zustand on the main feed tab were unreliable with tabs + stack).
 */
export default function FeedCommentPostScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ postId: string | string[]; eventId?: string | string[] }>();
  const postId = firstParam(params.postId);
  const hintEventId = firstParam(params.eventId);
  const user = useAuthStore((s) => s.user);
  const currentEventId = useEventStore((s) => s.currentEvent?.id ?? null);

  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!postId?.trim()) {
      setLoading(false);
      setError('Missing post.');
      return;
    }
    if (!user?.id) {
      setLoading(false);
      setError('Please sign in.');
      return;
    }

    let cancelled = false;
    const pid = postId.trim();

    (async () => {
      const ok = await resolveEventForOpenPost(pid, hintEventId ?? null);
      if (cancelled) return;
      if (!ok) {
        setError("You don't have access to this event.");
        setLoading(false);
        return;
      }

      const eventId = useEventStore.getState().currentEvent?.id;
      if (!eventId || cancelled) {
        setError('Could not select the event for this post.');
        setLoading(false);
        return;
      }

      const p = await loadPostForCommentSheet(
        pid,
        eventId,
        user.id,
        useBlockStore.getState().isBlocked
      );
      if (cancelled) return;
      if (!p) {
        setError('This post is no longer available.');
        setLoading(false);
        return;
      }
      setPost(p);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [postId, hintEventId, user?.id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.hint}>Opening post…</Text>
      </SafeAreaView>
    );
  }

  if (error || !post) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Text style={styles.error}>{error ?? 'Could not load this post.'}</Text>
        <Pressable style={styles.btn} onPress={() => router.replace('/(tabs)/feed' as any)}>
          <Text style={styles.btnText}>Back to feed</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.fill}>
      <CommentSheet
        embedded
        visible
        onClose={() => router.replace('/(tabs)/feed' as any)}
        post={post}
        eventId={currentEventId}
        currentUserId={user?.id ?? null}
        currentUserFullName={user?.full_name}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.surface,
  },
  hint: { marginTop: 12, fontSize: 15, color: colors.textSecondary },
  error: { fontSize: 16, color: colors.text, textAlign: 'center', marginBottom: 20 },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
