import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Image,
  Dimensions,
  Modal,
  Pressable,
  Share,
  Platform,
  Linking,
  BackHandler,
  Alert,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { useEventStore } from '../../stores/eventStore';
import { supabase, withRetryAndRefresh } from '../../lib/supabase';
import { colors } from '../../constants/colors';
import type { Post } from '../../lib/types';
import Toast from 'react-native-toast-message';
import { Heart, Share2, Link, Download, X } from 'lucide-react-native';

const COLS = 3;
const GAP = 4;

export default function PhotoBookScreen() {
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [sharing, setSharing] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchPhotos = useCallback(async () => {
    if (!currentEvent?.id || !user?.id) {
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
          .select('id, image_url, caption, created_at, likes_count, user:users(full_name)')
          .eq('event_id', currentEvent.id)
          .eq('is_deleted', false)
          .eq('is_approved', true)
          .not('image_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;

        const raw = (postsData ?? []) as Array<Record<string, unknown>>;
        const normalized: Post[] = raw.map((p) => ({
          ...p,
          user: Array.isArray(p.user) ? (p.user[0] ?? null) : p.user,
        })) as Post[];
        setPosts(normalized);
      });
      setFetchError(null);
    } catch (err) {
      if (__DEV__) console.warn('Photo book fetch error:', err);
      setPosts([]);
      setFetchError('Error - page not loading');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentEvent?.id, user?.id]);

  // Like Info: run and wait. No timer so first try can complete.
  useEffect(() => {
    if (!currentEvent?.id || !user?.id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchPhotos()
      .catch(() => { if (!cancelled) setTimeout(() => fetchPhotos().finally(() => {}), 2000); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentEvent?.id, user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (currentEvent?.id && user?.id) fetchPhotos().catch(() => {});
    }, [currentEvent?.id, user?.id])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && currentEvent?.id && user?.id) fetchPhotos().catch(() => {});
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
    if (!selectedPost) return;
    const onBack = () => {
      setSelectedPost(null);
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => {
      try {
        if (typeof subscription?.remove === 'function') {
          subscription.remove();
        }
      } catch (_) {
        // Some runtimes (e.g. Expo Go) may not implement subscription.remove correctly
      }
    };
  }, [selectedPost]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPhotos();
  };

  const win = Dimensions.get('window');
  const size = (win.width - (COLS - 1) * GAP) / COLS;

  const handleShare = async (imageUrl: string) => {
    setSharing(true);
    try {
      const filename = imageUrl.split('/').pop()?.split('?')[0] || `photo-${Date.now()}.jpg`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      const downloadResult = await FileSystem.downloadAsync(imageUrl, fileUri);
      const localUri = downloadResult.uri;
      const result = await Share.share(
        Platform.OS === 'ios'
          ? { url: localUri, title: 'Photo from event' }
          : { url: localUri, message: 'Photo from event', title: 'Photo from event' }
      );
      if (result.action === Share.sharedAction) {
        Toast.show({ type: 'success', text1: 'Shared', text2: 'You can save or share from the menu.' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      Toast.show({ type: 'error', text1: 'Share failed', text2: msg });
      Alert.alert('Share failed', msg + '\n\nTry "Open in browser" and save from there.');
    } finally {
      setSharing(false);
    }
  };

  const handleSaveToPhotos = async (imageUrl: string) => {
    setSaving(true);
    try {
      // Expo Go cannot provide full media library access on Android; show clear message
      if (Constants.appOwnership === 'expo') {
        setSaving(false);
        Alert.alert(
          'Save to Photos',
          "In Expo Go, saving to your camera roll isn't available. Use \"Open in browser\" below, then long-press the image and choose Save image.",
          [{ text: 'OK' }]
        );
        return;
      }
      // Request only photo/write permission so we don't trigger undeclared AUDIO permission (Android)
      const { status } = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access in Settings to save photos.');
        setSaving(false);
        return;
      }
      const filename = imageUrl.split('/').pop()?.split('?')[0] || `photo-${Date.now()}.jpg`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      const { uri } = await FileSystem.downloadAsync(imageUrl, fileUri);
      await MediaLibrary.saveToLibraryAsync(uri);
      Toast.show({ type: 'success', text1: 'Saved', text2: 'Photo saved to your camera roll.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      Toast.show({ type: 'error', text1: 'Save failed', text2: msg });
      Alert.alert('Save failed', msg + '\n\nTry "Open in browser" and long-press the image to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenLink = (imageUrl: string) => {
    Linking.openURL(imageUrl).then(() => {
      Toast.show({ type: 'success', text1: 'Opened', text2: 'Long-press the image in the browser to save.' });
    }).catch(() => {
      Toast.show({ type: 'error', text1: 'Could not open link' });
    });
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.subtitle}>Join an event on the Info tab to view the photo book.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>Error - page not loading</Text>
          <Text style={styles.subtitle}>Pull down to refresh or tap Try again.</Text>
          <TouchableOpacity
            onPress={() => {
              setFetchError(null);
              setLoading(true);
              fetchPhotos();
            }}
            style={styles.retryBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.subtitle}>Loading photos…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Photo book</Text>
      </View>
      {posts.length === 0 ? (
        <View style={styles.placeholder}>
          <Text style={styles.subtitle}>No photos yet. Post from the Feed to build the photo book!</Text>
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          numColumns={COLS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          initialNumToRender={15}
          maxToRenderPerBatch={12}
          windowSize={5}
          removeClippedSubviews={true}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
          renderItem={({ item }) => {
            const post = item as Post & { image_url?: string };
            const uri = post.image_url;
            const likesCount = post.likes_count ?? 0;
            if (!uri) return null;
            return (
              <TouchableOpacity
                style={[styles.thumb, { width: size, height: size }]}
                onPress={() => setSelectedPost(item as Post)}
                onLongPress={() => handleShare(uri)}
                activeOpacity={0.9}
                delayLongPress={400}
              >
                <Image source={{ uri }} style={styles.thumbImage} resizeMode="cover" />
                {likesCount > 0 && (
                  <View style={styles.thumbLikes}>
                    <Heart size={12} color="#fff" fill="#fff" />
                    <Text style={styles.thumbLikesText}>{likesCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal visible={!!selectedPost} transparent animationType="fade" onRequestClose={() => setSelectedPost(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedPost(null)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.modalContent}>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setSelectedPost(null)}
              hitSlop={16}
              accessibilityLabel="Close"
            >
              <X size={28} color="#fff" />
            </TouchableOpacity>
            {selectedPost && (selectedPost as Post & { image_url?: string }).image_url ? (
              <>
                <Image
                  source={{ uri: (selectedPost as Post & { image_url?: string }).image_url }}
                  style={styles.modalImage}
                  resizeMode="contain"
                />
                <View style={styles.modalMeta}>
                  {(selectedPost.likes_count ?? 0) > 0 && (
                    <View style={styles.modalLikes}>
                      <Heart size={16} color="#fff" fill="#fff" />
                      <Text style={styles.modalLikesText}>{selectedPost.likes_count} likes</Text>
                    </View>
                  )}
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.saveBtn]}
                      onPress={() => handleSaveToPhotos((selectedPost as Post & { image_url?: string }).image_url!)}
                      disabled={saving}
                    >
                      {saving ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Download size={20} color="#fff" />
                      )}
                      <Text style={[styles.actionBtnText, styles.saveBtnText]}>{saving ? 'Saving…' : 'Save'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => handleShare((selectedPost as Post & { image_url?: string }).image_url!)}
                      disabled={sharing}
                    >
                      {sharing ? (
                        <ActivityIndicator size="small" color={colors.text} />
                      ) : (
                        <Share2 size={20} color={colors.text} />
                      )}
                      <Text style={styles.actionBtnText}>{sharing ? 'Preparing…' : 'Share'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => handleOpenLink((selectedPost as Post & { image_url?: string }).image_url!)}
                    >
                      <Link size={20} color={colors.text} />
                      <Text style={styles.actionBtnText} numberOfLines={1}>Open</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            ) : null}
            {selectedPost?.caption ? (
              <Text style={styles.modalCaption} numberOfLines={3}>
                {selectedPost.caption}
              </Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'left' },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  placeholderTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: colors.primary,
    borderRadius: 10,
  },
  retryBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  grid: { padding: GAP / 2, paddingBottom: 24 },
  row: { marginBottom: GAP, gap: GAP },
  thumb: { marginRight: GAP, position: 'relative' },
  thumbImage: { width: '100%', height: '100%', borderRadius: 4 },
  thumbLikes: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  thumbLikesText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: { width: '100%', maxHeight: '90%', padding: 16, position: 'relative' },
  modalClose: { position: 'absolute', top: 8, right: 8, zIndex: 10, padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  modalImage: { width: '100%', aspectRatio: 1, borderRadius: 8 },
  modalMeta: { marginTop: 12 },
  modalLikes: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  modalLikesText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  modalActions: { flexDirection: 'row', gap: 8, flexWrap: 'nowrap' },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 0,
  },
  saveBtn: { backgroundColor: colors.primary },
  saveBtnText: { color: '#fff' },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: colors.text },
  modalCaption: { color: '#fff', marginTop: 12, fontSize: 14, paddingHorizontal: 8 },
});
