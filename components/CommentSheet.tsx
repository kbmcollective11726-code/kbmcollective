import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Heart } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { awardPoints } from '../lib/points';
import { createNotificationAndPush } from '../lib/notifications';
import type { Post, Comment } from '../lib/types';
import { colors } from '../constants/colors';
import Avatar from './Avatar';
import { formatDistanceToNow } from 'date-fns';

interface CommentSheetProps {
  visible: boolean;
  onClose: () => void;
  post: Post | null;
  eventId: string | null;
  currentUserId: string | null;
  currentUserFullName?: string | null;
  onCommentAdded?: () => void;
  /** Full-screen page (notification / deep link): show post + comments, no bottom sheet modal */
  embedded?: boolean;
}

export default function CommentSheet({
  visible,
  onClose,
  post,
  eventId,
  currentUserId,
  currentUserFullName,
  onCommentAdded,
  embedded = false,
}: CommentSheetProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [likingCommentId, setLikingCommentId] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    if (!post?.id) {
      setComments([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('comments')
        .select('*, user:users(id, full_name, avatar_url)')
        .eq('post_id', post.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      const rows = (data ?? []) as Comment[];
      if (!currentUserId || rows.length === 0) {
        setComments(rows);
        return;
      }
      const commentIds = rows.map((c) => c.id);
      const { data: myLikes } = await supabase
        .from('comment_likes')
        .select('comment_id')
        .eq('user_id', currentUserId)
        .in('comment_id', commentIds);
      const likedSet = new Set((myLikes ?? []).map((r: { comment_id: string }) => r.comment_id));
      setComments(rows.map((c) => ({ ...c, user_liked: likedSet.has(c.id) })));
    } catch (err) {
      console.error('Comments fetch error:', err);
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [post?.id, currentUserId]);

  const active = embedded || visible;

  useEffect(() => {
    if (active && post?.id) {
      setLoading(true);
      fetchComments();
    }
  }, [active, post?.id, fetchComments]);

  useEffect(() => {
    if (!active || !post?.id) return;
    const channel = supabase
      .channel('comments-' + post.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${post.id}` },
        () => fetchComments()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'comments', filter: `post_id=eq.${post.id}` },
        () => fetchComments()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [active, post?.id, fetchComments]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || !currentUserId || !post?.id || !eventId) return;
    setSending(true);
    try {
      const { data: newComment, error } = await supabase
        .from('comments')
        .insert({ post_id: post.id, user_id: currentUserId, content })
        .select('id')
        .single();

      if (error) throw error;

      if (post.user_id !== currentUserId) {
        await awardPoints(currentUserId, eventId, 'comment', newComment?.id);
      }
      if (post.user_id && post.user_id !== currentUserId) {
        await awardPoints(post.user_id, eventId, 'receive_comment', newComment?.id);
        if (eventId) {
          await createNotificationAndPush(
            post.user_id,
            eventId,
            'comment',
            `${currentUserFullName ?? 'Someone'} commented on your post`,
            content,
            { post_id: post.id, comment_id: newComment?.id }
          );
        }
      }
      setInput('');
      await fetchComments();
      onCommentAdded?.();
    } catch (err) {
      console.error('Comment error:', err);
    } finally {
      setSending(false);
    }
  };

  const handleCommentLike = async (comment: Comment) => {
    if (!currentUserId || !eventId || !post?.id) return;
    if (comment.user_id === currentUserId) return;
    if (likingCommentId === comment.id) return;

    const wasLiked = !!comment.user_liked;
    const currentCount = comment.likes_count ?? 0;
    const nextCount = wasLiked ? Math.max(0, currentCount - 1) : currentCount + 1;
    setLikingCommentId(comment.id);
    setComments((prev) =>
      prev.map((c) =>
        c.id === comment.id ? { ...c, user_liked: !wasLiked, likes_count: nextCount } : c
      )
    );

    try {
      if (wasLiked) {
        await supabase
          .from('comment_likes')
          .delete()
          .eq('comment_id', comment.id)
          .eq('user_id', currentUserId);
      } else {
        const { data: likeRow, error: insertError } = await supabase
          .from('comment_likes')
          .insert({ comment_id: comment.id, user_id: currentUserId })
          .select('id')
          .single();

        if (insertError?.code === '23505') {
          setComments((prev) =>
            prev.map((c) =>
              c.id === comment.id
                ? { ...c, user_liked: wasLiked, likes_count: comment.likes_count ?? 0 }
                : c
            )
          );
          return;
        }
        if (insertError) throw insertError;

        await awardPoints(currentUserId, eventId, 'give_comment_like', comment.id);
        if (comment.user_id && likeRow?.id) {
          await awardPoints(comment.user_id, eventId, 'receive_comment_like', likeRow.id);
          await createNotificationAndPush(
            comment.user_id,
            eventId,
            'like',
            `${currentUserFullName ?? 'Someone'} liked your comment`,
            null,
            { post_id: post.id, comment_id: comment.id }
          );
        }
      }
      await fetchComments();
    } catch (err) {
      console.error('Comment like error:', err);
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id
            ? { ...c, user_liked: wasLiked, likes_count: comment.likes_count ?? 0 }
            : c
        )
      );
    } finally {
      setLikingCommentId(null);
    }
  };

  if (!post) return null;
  if (!embedded && !visible) return null;

  const postListHeader = embedded ? (
    <View style={styles.embeddedPost}>
      <View style={styles.postHeaderRow}>
        <Avatar uri={post.user?.avatar_url} name={post.user?.full_name} size={44} />
        <View style={styles.postHeaderText}>
          <Text style={styles.postAuthor}>{post.user?.full_name ?? 'Someone'}</Text>
          <Text style={styles.postTime}>
            {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
          </Text>
        </View>
      </View>
      {post.image_url ? (
        <Image source={{ uri: post.image_url }} style={styles.postImage} resizeMode="cover" />
      ) : null}
      {post.caption ? <Text style={styles.postCaption}>{post.caption}</Text> : null}
      <Text style={styles.commentsSectionLabel}>Comments</Text>
    </View>
  ) : null;

  const listEmptyText = <Text style={styles.empty}>No comments yet. Be the first!</Text>;

  const renderComment = ({ item }: { item: Comment }) => {
    const isOwn = item.user_id === currentUserId;
    const likeCount = item.likes_count ?? 0;
    return (
      <View style={styles.commentRow}>
        <Avatar uri={item.user?.avatar_url} name={item.user?.full_name} size={36} />
        <View style={styles.commentBody}>
          <Text style={styles.commentName}>{item.user?.full_name ?? 'Someone'}</Text>
          <Text style={styles.commentContent}>{item.content}</Text>
          <View style={styles.commentMetaRow}>
            <Text style={styles.commentTime}>
              {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
            </Text>
            <TouchableOpacity
              style={[styles.commentLikeBtn, isOwn && styles.commentLikeBtnDisabled]}
              onPress={() => void handleCommentLike(item)}
              disabled={isOwn || likingCommentId === item.id}
              hitSlop={8}
            >
              <Heart
                size={14}
                color={item.user_liked ? colors.danger : colors.textMuted}
                fill={item.user_liked ? colors.danger : 'transparent'}
              />
              {likeCount > 0 ? (
                <Text style={[styles.commentLikeCount, item.user_liked && styles.commentLikeCountActive]}>
                  {likeCount}
                </Text>
              ) : null}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const inputBar = (
    <View style={styles.inputRow}>
      <TextInput
        style={styles.input}
        placeholder="Add a comment..."
        placeholderTextColor={colors.textMuted}
        value={input}
        onChangeText={setInput}
        multiline
        maxLength={500}
        editable={!sending}
      />
      <TouchableOpacity
        style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
        onPress={handleSend}
        disabled={!input.trim() || sending}
      >
        {sending ? (
          <ActivityIndicator size="small" color={colors.textOnPrimary} />
        ) : (
          <Text style={styles.sendText}>Post</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  if (embedded && postListHeader) {
    return (
      <KeyboardAvoidingView
        style={styles.embeddedRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <SafeAreaView style={styles.embeddedSafe} edges={['bottom']}>
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            style={styles.listFlex}
            contentContainerStyle={styles.listContentEmbedded}
            ListHeaderComponent={postListHeader}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
              ) : (
                listEmptyText
              )
            }
            renderItem={renderComment}
          />
          {inputBar}
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  const commentListModal = loading ? (
    <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
  ) : (
    <FlatList
      data={comments}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={listEmptyText}
      renderItem={renderComment}
    />
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <KeyboardAvoidingView
          style={styles.sheetWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()} style={styles.sheet}>
            <SafeAreaView style={styles.safe} edges={['bottom']}>
              <View style={styles.header}>
                <Text style={styles.headerTitle}>Comments</Text>
                <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
                  <X size={24} color={colors.text} />
                </TouchableOpacity>
              </View>
              {commentListModal}
              {inputBar}
            </SafeAreaView>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    maxHeight: '80%',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '100%',
  },
  safe: {
    maxHeight: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  loader: {
    marginVertical: 32,
  },
  list: {
    padding: 16,
    paddingBottom: 8,
    minHeight: 120,
  },
  empty: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 24,
  },
  commentRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  commentBody: {
    marginLeft: 12,
    flex: 1,
  },
  commentName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  commentContent: {
    fontSize: 14,
    color: colors.text,
    marginTop: 2,
  },
  commentTime: {
    fontSize: 12,
    color: colors.textMuted,
  },
  commentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 12,
  },
  commentLikeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  commentLikeBtnDisabled: {
    opacity: 0.45,
  },
  commentLikeCount: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  commentLikeCountActive: {
    color: colors.danger,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    gap: 12,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 48,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  embeddedRoot: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  embeddedSafe: {
    flex: 1,
  },
  listFlex: {
    flex: 1,
  },
  listContentEmbedded: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexGrow: 1,
  },
  embeddedPost: {
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  postHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  postHeaderText: {
    marginLeft: 12,
    flex: 1,
  },
  postAuthor: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  postTime: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  postImage: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 360,
    borderRadius: 12,
    backgroundColor: colors.borderLight,
  },
  postCaption: {
    fontSize: 15,
    color: colors.text,
    marginTop: 12,
    lineHeight: 22,
  },
  commentsSectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: 20,
    marginBottom: 4,
  },
});
