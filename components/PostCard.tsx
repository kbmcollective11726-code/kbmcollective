import { View, Text, Image, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Heart, MessageCircle } from 'lucide-react-native';
import type { Post } from '../lib/types';
import { colors } from '../constants/colors';
import Avatar from './Avatar';
import { formatDistanceToNow } from 'date-fns';

interface PostCardProps {
  post: Post;
  onLike: () => void;
  onComment: () => void;
  onPressUser?: (userId: string) => void;
  isOwnPost?: boolean;
}

export default function PostCard({ post, onLike, onComment, onPressUser, isOwnPost }: PostCardProps) {
  const displayName = post.user?.full_name ?? 'Someone';
  const userId = post.user_id;

  const headerContent = (
    <>
      <Avatar uri={post.user?.avatar_url} name={post.user?.full_name} size={40} />
      <View style={styles.headerText}>
        <Text style={styles.name}>{displayName}</Text>
        <Text style={styles.time}>{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</Text>
      </View>
    </>
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {onPressUser && userId ? (
          <TouchableOpacity style={styles.headerTouch} onPress={() => onPressUser(userId)} activeOpacity={0.7}>
            {headerContent}
          </TouchableOpacity>
        ) : (
          headerContent
        )}
      </View>
      <Image source={{ uri: post.image_url }} style={styles.image} resizeMode="cover" />
      {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, isOwnPost && styles.actionBtnDisabled]}
          onPress={isOwnPost ? undefined : onLike}
          hitSlop={12}
          disabled={isOwnPost}
        >
          <Heart
            size={22}
            color={post.user_liked ? colors.danger : isOwnPost ? colors.textMuted : colors.textMuted}
            fill={post.user_liked ? colors.danger : 'transparent'}
          />
          <Text style={[styles.actionText, isOwnPost && styles.actionTextMuted]}>
            {post.likes_count} {post.likes_count === 1 ? 'like' : 'likes'}
            {isOwnPost ? ' (your post)' : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={onComment} hitSlop={12}>
          <MessageCircle size={22} color={colors.textMuted} />
          <Text style={styles.actionText}>{post.comments_count} {post.comments_count === 1 ? 'comment' : 'comments'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const cardShadow = Platform.select({
  ios: {
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  android: { elevation: 3 },
  default: {},
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...cardShadow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerText: {
    marginLeft: 12,
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  time: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  image: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.surface,
  },
  caption: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 24,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  actionBtnDisabled: { opacity: 0.6 },
  actionTextMuted: { color: colors.textMuted },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});
