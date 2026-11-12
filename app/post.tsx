import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Camera, ImageIcon, X } from 'lucide-react-native';
import { useAuthStore } from '../stores/authStore';
import { useEventStore } from '../stores/eventStore';
import { pickImage, uploadImage, compressAndHashImage } from '../lib/image';
import { awardPoints } from '../lib/points';
import { supabaseStorage } from '../lib/supabase';
import { publishRecentFeedPost } from '../lib/recentFeedPosts';
import { navigateToFeedRoot } from '../lib/navigateToFeedRoot';
import type { Post } from '../lib/types';
import { colors } from '../constants/colors';
import { useEventThemeColor } from '../lib/eventTheme';

type PreparedPhoto = Awaited<ReturnType<typeof compressAndHashImage>>;

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return typeof v === 'string' ? v : v[0];
}

function safeReturnPath(from: string | undefined): string {
  if (!from) return '/(tabs)/feed';
  try {
    const decoded = decodeURIComponent(from);
    if (!decoded.startsWith('/') || decoded.includes('://')) return '/(tabs)/feed';
    if (decoded.includes('/post')) return '/(tabs)/feed';
    return decoded;
  } catch {
    return '/(tabs)/feed';
  }
}

/** fullScreenModal on iOS can report insets.top as 0 — keep header below status bar / Dynamic Island. */
function usePostTopInset(): number {
  const insets = useSafeAreaInsets();
  if (insets.top > 0) return insets.top;
  if (Platform.OS === 'ios') return 54;
  return 0;
}

export default function PostScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ from?: string | string[] }>();
  const returnTo = safeReturnPath(firstParam(params.from));
  const { user, session } = useAuthStore();
  const { currentEvent } = useEventStore();
  const themeColor = useEventThemeColor();
  const topInset = usePostTopInset();
  const insets = useSafeAreaInsets();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const killSwitchRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const postStartTimeRef = useRef<number>(0);
  const postingRef = useRef(false);
  const preparedPhotoRef = useRef<{ sourceUri: string; promise: Promise<PreparedPhoto> } | null>(null);

  const handlePick = async (source: 'camera' | 'library') => {
    const uri = await pickImage(source);
    if (!uri) return;
    setPhotoUri(uri);
    // Start image preparation as soon as the picker closes. In the usual flow
    // this completes while the user previews the photo or types a caption, so
    // tapping Share can move directly to upload.
    const promise = compressAndHashImage(uri);
    promise.catch(() => {});
    preparedPhotoRef.current = { sourceUri: uri, promise };
  };

  const handlePost = async () => {
    if (!user?.id || !currentEvent?.id) {
      Alert.alert('No event', 'Select an event on the Info tab first.');
      return;
    }
    if (!photoUri) {
      Alert.alert('No photo', 'Take or pick a photo first.');
      return;
    }
    if (postingRef.current || uploading) return;
    postingRef.current = true;
    setUploading(true);
    setUploadStage('Preparing…');
    if (__DEV__) console.log('[Post] Preparing photo');
    postStartTimeRef.current = Date.now();
    const postTimeoutMs = 75_000;
    const safetyMs = 80_000;
    const killSwitchMs = 75_000;
    const clearUploadGuards = () => {
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      if (killSwitchRef.current) {
        clearInterval(killSwitchRef.current);
        killSwitchRef.current = null;
      }
    };
    safetyTimerRef.current = setTimeout(() => {
      postingRef.current = false;
      setUploading(false);
      setUploadStage(null);
      safetyTimerRef.current = null;
      Alert.alert('Post timed out', 'Check your connection and try again.');
    }, safetyMs);
    killSwitchRef.current = setInterval(() => {
      if (Date.now() - postStartTimeRef.current >= killSwitchMs) {
        clearUploadGuards();
        postingRef.current = false;
        setUploading(false);
        setUploadStage(null);
        Alert.alert('Post timed out', 'Check your connection and try again.');
      }
    }, 2000);
    const timeoutPromise = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Post timed out. Check your connection and try again.')), postTimeoutMs)
    );
    try {
      // Use the session already established at sign-in. Forcing a token refresh
      // before every upload made Share depend on an unnecessary auth request and
      // could block before image preparation even started.
      if (!session?.access_token) {
        throw new Error('Your session expired. Please sign in again, then post the photo.');
      }

      await Promise.race([
        (async () => {
      const compressTimeoutMs = 30_000;
      const preparedPhoto =
        preparedPhotoRef.current?.sourceUri === photoUri
          ? preparedPhotoRef.current.promise
          : compressAndHashImage(photoUri);
      const { compressedUri, imageHash, base64 } = await Promise.race([
        preparedPhoto,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Photo preparation timed out. Try a smaller photo.')), compressTimeoutMs)
        ),
      ]);

      // Prefer default-fetch client on both platforms so insert does not hang
      // behind a stalled custom fetch body decode.
      const db = supabaseStorage;
      // Prevent double-posting the same picture in this event
      const duplicateCheckTimeoutMs = 12_000;
      let existing: { id: string } | null = null;
      try {
        const result = await Promise.race([
          db
            .from('posts')
            .select('id')
            .eq('event_id', currentEvent.id)
            .eq('user_id', user.id)
            .eq('image_hash', imageHash)
            .eq('is_deleted', false)
            .limit(1)
            .maybeSingle(),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('Connection slow')), duplicateCheckTimeoutMs)
          ),
        ]);
        existing = (result as { data: { id: string } | null }).data;
      } catch {
        existing = null;
      }
      if (existing) {
        Alert.alert(
          'Same photo already posted',
          'You’ve already posted this photo in this event. Choose a different photo.',
          [{ text: 'OK' }]
        );
        return;
      }

      let imageUrl: string | null = null;
      try {
        setUploadStage('Uploading…');
        if (__DEV__) console.log('[Post] Uploading photo to event storage');
        imageUrl = await uploadImage(compressedUri, currentEvent.id, user.id, 'event-photos', { skipCompress: true, base64 });
        if (__DEV__) console.log('[Post] Photo upload completed');
      } catch (uploadErr) {
        const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        Alert.alert('Upload failed', msg || 'Could not upload the photo. Try again.');
        return;
      }
      if (!imageUrl) {
        Alert.alert('Upload failed', 'Could not upload the photo. Try again.');
        return;
      }
      const dbTimeoutMs = 20_000;
      const postId = Crypto.randomUUID();
      const createdAt = new Date().toISOString();
      setUploadStage('Publishing…');
      if (__DEV__) console.log('[Post] Saving feed post');
      // Do not request the inserted row back. Expo Go was receiving the HTTP
      // success headers but hanging on the JSON response body. PostgREST's
      // default return=minimal response confirms the save without a body.
      const insertPromise = db
        .from('posts')
        .insert({
          id: postId,
          event_id: currentEvent.id,
          user_id: user.id,
          image_url: imageUrl,
          caption: caption.trim() || null,
          image_hash: imageHash,
        });
      const { error } = await Promise.race([
        insertPromise,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Saving post timed out. Try again.')), dbTimeoutMs)
        ),
      ]);

      if (error) throw error;
      if (__DEV__) console.log('[Post] Feed post saved');

      // Points are secondary to publishing. Pass the saved post ID required by
      // award_points_secure, but do not keep Share waiting for the RPC.
      awardPoints(user.id, currentEvent.id, 'post_photo', postId).catch(() => {});
      const recentPost: Post = {
        id: postId,
        event_id: currentEvent.id,
        user_id: user.id,
        image_url: imageUrl,
        caption: caption.trim() || null,
        image_hash: imageHash,
        likes_count: 0,
        comments_count: 0,
        is_pinned: false,
        is_approved: true,
        is_deleted: false,
        created_at: createdAt,
        user,
        user_liked: false,
      };
      // The database insert has succeeded. Seed the mounted Feed immediately
      // instead of making navigation wait for another network round trip.
      publishRecentFeedPost(recentPost);
      preparedPhotoRef.current = null;
      setPhotoUri(null);
      setCaption('');
      clearUploadGuards();
      postingRef.current = false;
      setUploading(false);
      setUploadStage(null);
      // Dismiss the post sheet fully, then land on feed — avoids iOS card-modal
      // leaving the Feed “pushed aside” / offset for a moment after share.
      try {
        if (typeof router.canDismiss === 'function' && router.canDismiss()) {
          router.dismiss();
        }
      } catch {
        /* continue to feed */
      }
      navigateToFeedRoot(navigation);
        })(),
        timeoutPromise,
      ]);
    } catch (err) {
      console.error('Post error:', err);
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to post.');
    } finally {
      clearUploadGuards();
      postingRef.current = false;
      setUploading(false);
      setUploadStage(null);
    }
  };

  const handleClose = () => {
    preparedPhotoRef.current = null;
    // Don't rely on router.back() — after the system camera, history can point at
    // the wrong tab (e.g. Community). Return to the screen that opened Post.
    try {
      if (returnTo.includes('/feed')) {
        navigateToFeedRoot(navigation);
        return;
      }
      router.replace(returnTo as never);
    } catch {
      navigateToFeedRoot(navigation);
    }
  };

  if (!currentEvent) {
    return (
      <View style={[styles.container, { paddingTop: topInset, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} hitSlop={12}>
            <X size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { flex: 1, marginLeft: 12 }]}>Post a photo</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.placeholder}>
          <Text style={styles.subtitle}>Select an event on the Info tab first.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topInset, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClose} hitSlop={12}>
          <X size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { flex: 1, marginLeft: 12 }]}>Post a photo</Text>
        <View style={{ width: 24 }} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        {photoUri ? (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
            <TextInput
              style={styles.captionInput}
              placeholder="Add a caption..."
              placeholderTextColor={colors.textMuted}
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={500}
              editable={!uploading}
            />
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.button, styles.buttonSecondary]}
                onPress={() => {
                  preparedPhotoRef.current = null;
                  setPhotoUri(null);
                }}
                disabled={uploading}
              >
                <Text style={styles.buttonSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary, { backgroundColor: themeColor }, uploading && styles.buttonDisabled]}
                onPress={handlePost}
                disabled={uploading}
              >
                {uploading ? (
                  <View style={styles.uploadingContent}>
                    <ActivityIndicator color={colors.textOnPrimary} size="small" />
                    <Text style={styles.buttonPrimaryText}>{uploadStage ?? 'Sharing…'}</Text>
                  </View>
                ) : (
                  <Text style={styles.buttonPrimaryText}>Share</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.title}>Post a photo</Text>
            <Text style={styles.subtitle}>Take or pick a photo to share with the event.</Text>
            <View style={styles.photoButtons}>
              <TouchableOpacity style={styles.photoButton} onPress={() => handlePick('camera')}>
                <Camera size={32} color={themeColor} />
                <Text style={[styles.photoButtonText, { color: themeColor }]}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoButton} onPress={() => handlePick('library')}>
                <ImageIcon size={32} color={themeColor} />
                <Text style={[styles.photoButtonText, { color: themeColor }]}>Gallery</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'left',
  },
  scroll: {
    padding: 16,
    paddingBottom: 32,
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: colors.surface,
    marginBottom: 16,
  },
  captionInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonPrimary: {},
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  uploadingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  buttonSecondaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 24,
  },
  photoButton: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoButtonText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
  },
});
