import { memo, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { Heart, MessageCircle, Trash2 } from 'lucide-react-native';
import type { Post } from '../lib/types';
import { colors } from '../constants/colors';
import { useEventThemeColor } from '../lib/eventTheme';
import Avatar from './Avatar';
import { formatDistanceToNow } from 'date-fns';

interface PostCardProps {
  post: Post;
  onLike: (post: Post) => void;
  onComment: (post: Post) => void;
  onPressUser?: (userId: string) => void;
  onPressImage?: (post: Post) => void;
  isOwnPost?: boolean;
  onDelete?: (post: Post) => void;
  likeDisabled?: boolean;
}

function PostCard({ post, onLike, onComment, onPressUser, onPressImage, isOwnPost, onDelete, likeDisabled }: PostCardProps) {
  const themeColor = useEventThemeColor();
  const displayName = post.user?.full_name ?? 'Someone';
  const userId = post.user_id;
  const heartScale = useSharedValue(1);

  useEffect(() => {
    if (!post.user_liked) return;
    heartScale.value = withSequence(
      withSpring(1.35, { damping: 8, stiffness: 280 }),
      withSpring(1, { damping: 12, stiffness: 220 }),
    );
  }, [heartScale, post.user_liked, post.likes_count]);

  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const photo = (
    <Image
      source={{ uri: post.image_url }}
      style={styles.image}
      contentFit="cover"
      recyclingKey={post.id}
      cachePolicy="memory-disk"
      transition={150}
    />
  );

  const headerLeft = (
    <>
      <Avatar uri={post.user?.avatar_url} name={post.user?.full_name} size={40} />
      <View style={styles.headerText}>
        <Text style={styles.name}>{displayName}</Text>
        <Text style={styles.time}>{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</Text>
      </View>
    </>
  );

  return (
    <View style={[styles.card, { borderLeftColor: themeColor, borderLeftWidth: 3 }]}>
      <View style={styles.header}>
        {onPressUser && userId ? (
          <TouchableOpacity style={styles.headerTouch} onPress={() => onPressUser(userId)} activeOpacity={0.7}>
            {headerLeft}
          </TouchableOpacity>
        ) : (
          headerLeft
        )}
        {isOwnPost && onDelete && (
          <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(post)} hitSlop={12}>
            <Trash2 size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      {onPressImage ? (
        <TouchableOpacity style={styles.imageWrap} onPress={() => onPressImage(post)} activeOpacity={1}>
          {photo}
        </TouchableOpacity>
      ) : (
        photo
      )}
      {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, (isOwnPost || likeDisabled) && styles.actionBtnDisabled]}
          onPress={isOwnPost || likeDisabled ? undefined : () => onLike(post)}
          hitSlop={12}
          disabled={isOwnPost || likeDisabled}
        >
          <Animated.View style={heartStyle}>
            <Heart
              size={22}
              color={post.user_liked ? colors.danger : isOwnPost ? colors.textMuted : colors.textMuted}
              fill={post.user_liked ? colors.danger : 'transparent'}
            />
          </Animated.View>
          <Text style={[styles.actionText, isOwnPost && styles.actionTextMuted]}>
            {post.likes_count} {post.likes_count === 1 ? 'like' : 'likes'}
            {isOwnPost ? ' (your post)' : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onComment(post)} hitSlop={12}>
          <MessageCircle size={22} color={colors.textMuted} />
          <Text style={styles.actionText}>{post.comments_count} {post.comments_count === 1 ? 'comment' : 'comments'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default memo(PostCard);

const cardShadow = Platform.select({
  ios: {
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  android: { elevation: 1 },
  default: {},
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    marginHorizontal: 16,
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
  imageWrap: {
    width: '100%',
    aspectRatio: 4 / 3,
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
  deleteBtn: {
    padding: 8,
  },
});
