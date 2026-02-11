import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ImagePlus, X } from 'lucide-react-native';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { pickImage, uploadEventBanner } from '../../../lib/image';
import { colors } from '../../../constants/colors';

function parseWhatToExpect(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((x) => typeof x === 'string');
  return [];
}

export default function AdminInfoPageScreen() {
  const { currentEvent, setCurrentEvent } = useEventStore();
  const [welcomeTitle, setWelcomeTitle] = useState('');
  const [welcomeSubtitle, setWelcomeSubtitle] = useState('');
  const [heroStat1, setHeroStat1] = useState('');
  const [heroStat2, setHeroStat2] = useState('');
  const [heroStat3, setHeroStat3] = useState('');
  const [arrivalDayText, setArrivalDayText] = useState('');
  const [summitDaysText, setSummitDaysText] = useState('');
  const [themeText, setThemeText] = useState('');
  const [whatToExpectText, setWhatToExpectText] = useState('');
  const [pointsSectionIntro, setPointsSectionIntro] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  useEffect(() => {
    if (currentEvent) {
      setWelcomeTitle(currentEvent.welcome_title ?? '');
      setWelcomeSubtitle(currentEvent.welcome_subtitle ?? '');
      setHeroStat1(currentEvent.hero_stat_1 ?? '');
      setHeroStat2(currentEvent.hero_stat_2 ?? '');
      setHeroStat3(currentEvent.hero_stat_3 ?? '');
      setArrivalDayText(currentEvent.arrival_day_text ?? '');
      setSummitDaysText(currentEvent.summit_days_text ?? '');
      setThemeText(currentEvent.theme_text ?? '');
      const list = parseWhatToExpect(currentEvent.what_to_expect);
      setWhatToExpectText(list.join('\n'));
      setPointsSectionIntro(currentEvent.points_section_intro ?? '');
    }
  }, [currentEvent?.id]);

  const handleUploadBanner = async () => {
    if (!currentEvent?.id) return;
    const uri = await pickImage('library');
    if (!uri) return;
    setUploadingBanner(true);
    try {
      const url = await uploadEventBanner(uri, currentEvent.id);
      if (!url) {
        Alert.alert('Upload failed', 'Could not upload the banner. Try again.');
        return;
      }
      const { data, error } = await supabase
        .from('events')
        .update({ banner_url: url, updated_at: new Date().toISOString() })
        .eq('id', currentEvent.id)
        .select()
        .single();
      if (error) throw error;
      if (data) setCurrentEvent(data as typeof currentEvent);
      Alert.alert('Saved', 'Event banner updated. Attendees will see it on the Info screen.');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save banner.');
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleRemoveBanner = () => {
    if (!currentEvent?.id) return;
    Alert.alert(
      'Remove banner',
      'The Info screen will show the gradient instead. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase
                .from('events')
                .update({ banner_url: null, updated_at: new Date().toISOString() })
                .eq('id', currentEvent.id)
                .select()
                .single();
              if (error) throw error;
              if (data) setCurrentEvent(data as typeof currentEvent);
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to remove banner.');
            }
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    if (!currentEvent?.id) return;
    setSaving(true);
    try {
      const whatToExpect = whatToExpectText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const { data, error } = await supabase
        .from('events')
        .update({
          welcome_title: welcomeTitle.trim() || null,
          welcome_subtitle: welcomeSubtitle.trim() || null,
          hero_stat_1: heroStat1.trim() || null,
          hero_stat_2: heroStat2.trim() || null,
          hero_stat_3: heroStat3.trim() || null,
          arrival_day_text: arrivalDayText.trim() || null,
          summit_days_text: summitDaysText.trim() || null,
          theme_text: themeText.trim() || null,
          what_to_expect: whatToExpect,
          points_section_intro: pointsSectionIntro.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentEvent.id)
        .select()
        .single();
      if (error) throw error;
      if (data) setCurrentEvent(data as typeof currentEvent);
      Alert.alert('Saved', 'Info page updated.');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <Text style={styles.subtitle}>Select an event first.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Event code (share with attendees to join)</Text>
          <Text style={styles.codeValue}>{currentEvent.event_code ?? '—'}</Text>
        </View>

        <Text style={styles.sectionTitle}>Event banner (branding)</Text>
        <Text style={styles.label}>Shown at the top of the Info screen. Use your conference artwork for a branded look.</Text>
        {currentEvent.banner_url ? (
          <View style={styles.bannerPreviewWrap}>
            <Image source={{ uri: currentEvent.banner_url }} style={styles.bannerPreview} resizeMode="cover" />
            <View style={styles.bannerActions}>
              <TouchableOpacity
                style={[styles.bannerBtn, uploadingBanner && styles.bannerBtnDisabled]}
                onPress={handleUploadBanner}
                disabled={uploadingBanner}
              >
                {uploadingBanner ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <ImagePlus size={20} color={colors.primary} />
                )}
                <Text style={styles.bannerBtnText}>{uploadingBanner ? 'Uploading…' : 'Replace'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bannerBtnRemove} onPress={handleRemoveBanner}>
                <X size={20} color={colors.danger} />
                <Text style={styles.bannerBtnTextRemove}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.bannerPlaceholder, uploadingBanner && styles.bannerBtnDisabled]}
            onPress={handleUploadBanner}
            disabled={uploadingBanner}
          >
            {uploadingBanner ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <ImagePlus size={32} color={colors.textMuted} />
            )}
            <Text style={styles.bannerPlaceholderText}>Upload event banner</Text>
            <Text style={styles.bannerPlaceholderHint}>Recommended: wide image, e.g. 1200×600</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>Hero section (text)</Text>
        <Text style={styles.label}>Welcome title</Text>
        <TextInput
          style={styles.input}
          value={welcomeTitle}
          onChangeText={setWelcomeTitle}
          placeholder="e.g. Welcome to Front Office Summit 2025!"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.label}>Welcome subtitle</Text>
        <TextInput
          style={[styles.input, styles.area]}
          value={welcomeSubtitle}
          onChangeText={setWelcomeSubtitle}
          placeholder="e.g. Join us for an incredible journey..."
          placeholderTextColor={colors.textMuted}
          multiline
        />
        <Text style={styles.label}>Stat box 1</Text>
        <TextInput style={styles.input} value={heroStat1} onChangeText={setHeroStat1} placeholder="e.g. 3 Days of Excellence" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Stat box 2</Text>
        <TextInput style={styles.input} value={heroStat2} onChangeText={setHeroStat2} placeholder="e.g. 25+ Sessions Expert Speakers" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Stat box 3</Text>
        <TextInput style={styles.input} value={heroStat3} onChangeText={setHeroStat3} placeholder="e.g. Unlimited Networking" placeholderTextColor={colors.textMuted} />

        <Text style={styles.sectionTitle}>Event details (Info page)</Text>
        <Text style={styles.label}>Arrival day text</Text>
        <TextInput
          style={styles.input}
          value={arrivalDayText}
          onChangeText={setArrivalDayText}
          placeholder="e.g. Sunday, October 19, 2025 (Check-in & Welcome)"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.label}>Summit days text</Text>
        <TextInput
          style={styles.input}
          value={summitDaysText}
          onChangeText={setSummitDaysText}
          placeholder="e.g. Monday, Oct 20 - Wednesday, Oct 22, 2025"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.label}>Theme text</Text>
        <TextInput
          style={styles.input}
          value={themeText}
          onChangeText={setThemeText}
          placeholder="e.g. Excellence in Front Office Operations"
          placeholderTextColor={colors.textMuted}
        />

        <Text style={styles.sectionTitle}>What to expect</Text>
        <Text style={styles.label}>One line per bullet (leave empty for defaults)</Text>
        <TextInput
          style={[styles.input, styles.area]}
          value={whatToExpectText}
          onChangeText={setWhatToExpectText}
          placeholder="Interactive Workshops: Hands-on sessions..."
          placeholderTextColor={colors.textMuted}
          multiline
        />

        <Text style={styles.sectionTitle}>Earn points section</Text>
        <Text style={styles.label}>Points section intro</Text>
        <TextInput
          style={[styles.input, styles.area]}
          value={pointsSectionIntro}
          onChangeText={setPointsSectionIntro}
          placeholder="e.g. Participate actively and climb the leaderboard!"
          placeholderTextColor={colors.textMuted}
          multiline
        />

        <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.textOnPrimary} size="small" /> : <Text style={styles.buttonText}>Save info page</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 14, color: colors.textSecondary },
  codeCard: {
    backgroundColor: colors.primaryFaded,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  codeLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  codeValue: { fontSize: 22, fontWeight: '700', color: colors.primary, letterSpacing: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 8, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  bannerPreviewWrap: { marginBottom: 20 },
  bannerPreview: { width: '100%', height: 160, borderRadius: 12, backgroundColor: colors.borderLight },
  bannerActions: { flexDirection: 'row', gap: 12, marginTop: 10 },
  bannerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.primary },
  bannerBtnDisabled: { opacity: 0.6 },
  bannerBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  bannerBtnRemove: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14 },
  bannerBtnTextRemove: { fontSize: 14, fontWeight: '600', color: colors.danger },
  bannerPlaceholder: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  bannerPlaceholderText: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 8 },
  bannerPlaceholderHint: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: colors.text, marginBottom: 20 },
  area: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { fontSize: 16, fontWeight: '600', color: colors.textOnPrimary },
});
