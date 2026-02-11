import { useState } from 'react';
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
import { supabase } from '../lib/supabase';
import { colors } from '../constants/colors';

export default function PostScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);

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
    try {
      const { compressedUri, imageHash } = await compressAndHashImage(photoUri);
      let imageUrl: string | null = null;
      try {
        imageUrl = await uploadImage(compressedUri, currentEvent.id, user.id, 'event-photos', { skipCompress: true });
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
      const { data: post, error } = await supabase
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

      if (error) throw error;

      const result = await awardPoints(user.id, currentEvent.id, 'post_photo', post?.id);
      if (!result.awarded && result.points === 0) {
        Toast.show({
          type: 'info',
          text1: 'Same photo already posted',
          text2: 'No points this time.',
        });
      }
      setPhotoUri(null);
      setCaption('');
      router.back();
    } catch (err) {
      console.error('Post error:', err);
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to post.');
    } finally {
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
          <Text style={styles.headerTitle}>Post a photo</Text>
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
        <Text style={styles.headerTitle}>Post a photo</Text>
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
