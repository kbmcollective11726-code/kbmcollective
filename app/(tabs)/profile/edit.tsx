import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { supabase } from '../../../lib/supabase';
import { uploadAvatar } from '../../../lib/image';
import { colors } from '../../../constants/colors';
import Avatar from '../../../components/Avatar';
import { pickImage } from '../../../lib/image';
import { Link2, Check, Pencil } from 'lucide-react-native';

export default function EditProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { user, updateProfile, refreshUser } = useAuthStore();

  const goBack = useCallback(() => {
    const returnPath = from && typeof from === 'string' ? decodeURIComponent(from).trim() : null;
    if (returnPath) {
      router.replace(returnPath as any);
    } else {
      router.back();
    }
  }, [from, router]);

  useEffect(() => {
    if (from && typeof from === 'string') {
      navigation.setOptions({
        headerBackVisible: false,
        headerLeft: () => (
          <TouchableOpacity
            onPress={goBack}
            style={{ marginLeft: 8, padding: 4 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
        ),
      });
    }
  }, [from, goBack, navigation]);
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showLinkedInInput, setShowLinkedInInput] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name ?? '');
      setTitle(user.title ?? '');
      setCompany(user.company ?? '');
      setLinkedinUrl(user.linkedin_url ?? '');
      setShowLinkedInInput(!!user.linkedin_url);
      setBio(user.bio ?? '');
      setAvatarUrl(user.avatar_url ?? null);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      refreshUser().catch(() => {});
    }, [refreshUser])
  );

  const handlePickAvatar = async () => {
    if (!user?.id) return;
    const uri = await pickImage('library');
    if (!uri) return;
    setUploadingAvatar(true);
    try {
      const url = await uploadAvatar(uri, user.id);
      if (url) {
        setAvatarUrl(url);
        await updateProfile({ avatar_url: url });
      }
    } catch (err) {
      console.error('Avatar upload error:', err);
      Alert.alert('Error', 'Could not update avatar.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      Alert.alert('Error', 'Name is required.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await updateProfile({
        full_name: trimmedName,
        title: title.trim() || null,
        company: company.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        bio: bio.trim() || null,
      });
      if (error) throw new Error(error);
      await refreshUser();
      const returnPath = from && typeof from === 'string' ? decodeURIComponent(from).trim() : '';
      if (returnPath) {
        router.replace(returnPath as any);
      } else {
        router.back();
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handlePickAvatar}
            disabled={uploadingAvatar}
          >
            <Avatar uri={avatarUrl} name={fullName} size={100} />
            {uploadingAvatar && (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            )}
            <Text style={styles.avatarHint}>Tap to change photo</Text>
          </TouchableOpacity>

          <Text style={styles.label}>Full name</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Developer, Designer"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.label}>Company</Text>
          <TextInput
            style={styles.input}
            value={company}
            onChangeText={setCompany}
            placeholder="Company or organization"
            placeholderTextColor={colors.textMuted}
          />

          <View style={styles.linkedInSection}>
            {linkedinUrl.trim() ? (
              <>
                <View style={styles.linkedInConnected}>
                  <Check size={20} color={colors.secondary} />
                  <Text style={styles.linkedInConnectedText}>LinkedIn connected</Text>
                  <TouchableOpacity
                    onPress={() => setShowLinkedInInput(true)}
                    style={styles.changeBtn}
                    hitSlop={8}
                  >
                    <Pencil size={16} color={colors.primary} />
                    <Text style={styles.changeBtnText}>Change</Text>
                  </TouchableOpacity>
                </View>
                {showLinkedInInput && (
                  <TextInput
                    style={[styles.input, styles.linkedInInput]}
                    value={linkedinUrl}
                    onChangeText={setLinkedinUrl}
                    placeholder="https://linkedin.com/in/yourprofile"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    autoFocus
                  />
                )}
              </>
            ) : showLinkedInInput ? (
              <>
                <Text style={styles.label}>LinkedIn profile URL</Text>
                <TextInput
                  style={styles.input}
                  value={linkedinUrl}
                  onChangeText={setLinkedinUrl}
                  placeholder="https://linkedin.com/in/yourprofile"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  autoFocus
                />
                <TouchableOpacity
                  onPress={() => setShowLinkedInInput(false)}
                  style={styles.cancelLink}
                >
                  <Text style={styles.cancelLinkText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={styles.connectLinkedInBtn}
                onPress={() => setShowLinkedInInput(true)}
                activeOpacity={0.7}
              >
                <Link2 size={22} color="#0A66C2" />
                <View style={styles.connectLinkedInTextWrap}>
                  <Text style={styles.connectLinkedInTitle}>Connect LinkedIn</Text>
                  <Text style={styles.connectLinkedInHint}>
                    Add your profile URL so others can find you
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.bioInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="A short bio..."
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
          />

          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={colors.textOnPrimary} size="small" />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
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
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  avatarWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: 20,
  },
  bioInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  linkedInSection: {
    marginBottom: 20,
  },
  connectLinkedInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  connectLinkedInTextWrap: {
    marginLeft: 14,
    flex: 1,
  },
  connectLinkedInTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  connectLinkedInHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  linkedInConnected: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linkedInConnectedText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginLeft: 10,
    flex: 1,
  },
  changeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  changeBtnText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  linkedInInput: {
    marginTop: 12,
  },
  cancelLink: {
    marginTop: 8,
    paddingVertical: 4,
  },
  cancelLinkText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
});
