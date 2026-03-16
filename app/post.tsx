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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Camera, ImageIcon, X } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../stores/authStore';
import { useEventStore } from '../stores/eventStore';
import { pickImage, uploadImage, compressAndHashImage } from '../lib/image';
import { awardPoints } from '../lib/points';
import { supabase, supabaseStorage } from '../lib/supabase';
import { colors } from '../constants/colors';

export default function PostScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const killSwitchRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const postStartTimeRef = useRef<number>(0);

  const handlePick = async (source: 'camera' | 'library') => {
    const uri = await pickImage(source);
    if (uri) setPhotoUri(uri);
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
    setUploading(true);
    postStartTimeRef.current = Date.now();
    const postTimeoutMs = 90_000;
    const safetyMs = 95_000;
    const killSwitchMs = 90_000;
    safetyTimerRef.current = setTimeout(() => {
      setUploading(false);
      safetyTimerRef.current = null;
    }, safetyMs);
    killSwitchRef.current = setInterval(() => {
      if (Date.now() - postStartTimeRef.current >= killSwitchMs) {
        if (killSwitchRef.current) clearInterval(killSwitchRef.current);
        killSwitchRef.current = null;
        setUploading(false);
        Alert.alert('Post timed out', 'Check your connection and try again.');
      }
    }, 2000);
    const timeoutPromise = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Post timed out. Check your connection and try again.')), postTimeoutMs)
    );
    try {
      await Promise.race([
        (async () => {
      const compressTimeoutMs = 30_000;
      const { compressedUri, imageHash, base64 } = await Promise.race([
        compressAndHashImage(photoUri),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Photo preparation timed out. Try a smaller photo.')), compressTimeoutMs)
        ),
      ]);

      // On Android use client with default fetch so insert/select don't hang
      const db = Platform.OS === 'android' ? supabaseStorage : supabase;
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
        setUploading(false);
        return;
      }

      let imageUrl: string | null = null;
      try {
        imageUrl = await uploadImage(compressedUri, currentEvent.id, user.id, 'event-photos', { skipCompress: true, base64 });
      } catch (uploadErr) {
        const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        Alert.alert('Upload failed', msg || 'Could not upload the photo. Try again.');
        setUploading(false);
        return;
      }
      if (!imageUrl) {
        Alert.alert('Upload failed', 'Could not upload the photo. Try again.');
        setUploading(false);
        return;
      }
      const savedToStorage = imageUrl.includes('supabase.co/storage');
      const dbTimeoutMs = Platform.OS === 'android' ? 45_000 : 15_000;
      const insertPromise = db
        .from('posts')
        .insert({
          event_id: currentEvent.id,
          user_id: user.id,
          image_url: imageUrl,
          caption: caption.trim() || null,
          image_hash: imageHash,
        })
        .select('id')
        .single();
      const { data: post, error } = await Promise.race([
        insertPromise,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Saving post timed out. Try again.')), dbTimeoutMs)
        ),
      ]);

      if (error) throw error;

      if (Platform.OS === 'android') {
        awardPoints(user.id, currentEvent.id, 'post_photo', post?.id).catch(() => {});
      } else {
        const awardTimeoutMs = 15_000;
        try {
          const result = await Promise.race([
            awardPoints(user.id, currentEvent.id, 'post_photo', post?.id),
            new Promise<{ awarded: boolean; points: number }>((resolve) =>
              setTimeout(() => resolve({ awarded: false, points: 0 }), awardTimeoutMs)
            ),
          ]);
          if (!result.awarded && result.points === 0) {
            try { Toast.show({ type: 'info', text1: 'Same photo already posted', text2: 'No points this time.' }); } catch (_) {}
          }
        } catch (_) {
          // Points failed; post is still saved
        }
      }
      setPhotoUri(null);
      setCaption('');
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      if (killSwitchRef.current) {
        clearInterval(killSwitchRef.current);
        killSwitchRef.current = null;
      }
      if (savedToStorage) {
        const message = Platform.OS === 'android'
          ? 'Your photo was posted.'
          : 'Your photo was saved. (Cloud storage was unavailable, so it used backup storage.)';
        setTimeout(() => Alert.alert('Photo posted', message), 150);
      }
      router.back();
        })(),
        timeoutPromise,
      ]);
    } catch (err) {
      console.error('Post error:', err);
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to post.');
    } finally {
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      if (killSwitchRef.current) {
        clearInterval(killSwitchRef.current);
        killSwitchRef.current = null;
      }
      setUploading(false);
    }
  };

  const handleClose = () => {
    router.back();
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
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
                onPress={() => setPhotoUri(null)}
                disabled={uploading}
              >
                <Text style={styles.buttonSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary, uploading && styles.buttonDisabled]}
                onPress={handlePost}
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator color={colors.textOnPrimary} size="small" />
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
                <Camera size={32} color={colors.primary} />
                <Text style={styles.photoButtonText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoButton} onPress={() => handlePick('library')}>
                <ImageIcon size={32} color={colors.primary} />
                <Text style={styles.photoButtonText}>Gallery</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonDisabled: {
    opacity: 0.7,
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
    color: colors.primary,
  },
});
