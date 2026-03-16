import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  Pressable,
  FlatList,
} from 'react-native';
const SAVE_TIMEOUT_MS = 20_000;
function withSaveTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out. Check your connection and try again.`)), SAVE_TIMEOUT_MS)
    ),
  ]);
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ImagePlus, ChevronDown } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, supabaseStorage } from '../../../lib/supabase';
import { pickImage, uploadImage } from '../../../lib/image';
import { colors } from '../../../constants/colors';
import type { VendorBooth } from '../../../lib/types';

export default function AdminVendorBoothEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const boothId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : undefined;
  const isNew = !boothId;

  const [vendorName, setVendorName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [boothLocation, setBoothLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [contactUserId, setContactUserId] = useState<string | null>(null);
  const [eventMembers, setEventMembers] = useState<{ user_id: string; full_name: string }[]>([]);
  const [repDropdownVisible, setRepDropdownVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [loading, setLoading] = useState(!isNew);

  const fetchBooth = useCallback(async () => {
    if (!boothId) return;
    setLoading(true);
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      const { data, error } = (await withSaveTimeout(Promise.resolve(client.from('vendor_booths').select('*').eq('id', boothId).maybeSingle()), 'Load booth')) as { data: VendorBooth | null; error: unknown };
      if (error) throw error;
      if (!data) {
        Alert.alert('Booth not found', 'This booth may have been deleted.', [{ text: 'OK', onPress: () => router.replace('/profile/admin-vendor-booths') }]);
        return;
      }
      const b = data as VendorBooth & { banner_url?: string | null };
      setVendorName(b.vendor_name ?? '');
      setDescription(b.description ?? '');
      setLogoUrl(b.logo_url ?? '');
      setBannerUrl(b.banner_url ?? '');
      setBoothLocation(b.booth_location ?? '');
      setWebsite(b.website ?? '');
      setContactUserId(b.contact_user_id ?? null);
    } catch (e) {
      if (__DEV__) console.error('Fetch booth error:', e);
      Alert.alert('Error', 'Could not load booth. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [boothId, router]);

  useEffect(() => {
    if (boothId) fetchBooth();
  }, [boothId, fetchBooth]);

  useEffect(() => {
    if (!currentEvent?.id) {
      setEventMembers([]);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('event_members')
        .select('user_id, users!inner(full_name)')
        .eq('event_id', currentEvent.id)
        .neq('role', 'super_admin');
      if (error) return;
      type Row = { user_id: string; users: { full_name: string } | { full_name: string }[] };
      const list = (data ?? []).map((r: Row) => {
        const u = Array.isArray(r.users) ? r.users[0] : r.users;
        return { user_id: r.user_id, full_name: u?.full_name ?? 'Unknown' };
      });
      setEventMembers(list);
    })();
  }, [currentEvent?.id]);

  const handleDeleteBooth = useCallback(() => {
    if (!boothId) return;
    Alert.alert(
      'Delete vendor booth?',
      'This will remove the booth and all its scheduled meetings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            const client = Platform.OS === 'android' ? supabaseStorage : supabase;
            try {
              const { error } = (await withSaveTimeout(Promise.resolve(client.from('vendor_booths').delete().eq('id', boothId)), 'Delete booth')) as { error: unknown };
              if (error) throw error;
              Alert.alert('Deleted', 'Vendor booth and its meetings have been removed.', [{ text: 'OK', onPress: () => router.replace('/profile/admin-vendor-booths') }]);
            } catch (e: unknown) {
              console.error('Delete booth error:', e);
              const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Could not delete booth.';
              Alert.alert('Error', msg);
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }, [boothId, router]);

  const handleSaveBooth = async () => {
    if (!currentEvent?.id || !vendorName.trim()) {
      Alert.alert('Error', 'Vendor name is required.');
      return;
    }
    setSaving(true);
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    try {
      if (isNew) {
        const payload: Record<string, unknown> = {
          event_id: currentEvent.id,
          vendor_name: vendorName.trim(),
          description: description.trim() || null,
          logo_url: logoUrl.trim() || null,
          booth_location: boothLocation.trim() || null,
          website: website.trim() || null,
          contact_user_id: contactUserId || null,
          is_active: true,
        };
        if (bannerUrl.trim()) payload.banner_url = bannerUrl.trim();
        const { data, error } = (await withSaveTimeout(
          Promise.resolve(client.from('vendor_booths').insert(payload).select('id').single()),
          'Save booth'
        )) as { data: { id: string } | null; error: { code?: string } | null };
        if (error) {
          const isBannerColumnMissing = (String(error.code) === '42703' || String(error.code) === 'PGRST204') && payload.banner_url;
          if (isBannerColumnMissing) {
            delete payload.banner_url;
            const retry = (await withSaveTimeout(Promise.resolve(client.from('vendor_booths').insert(payload).select('id').single()), 'Save booth')) as { data: { id: string } | null; error: unknown };
            if (retry.error) throw retry.error;
            const newId = retry.data!.id;
            Alert.alert('Saved', 'Vendor booth created (banner not saved — banner_url column may need a moment to appear). Assign meetings from the B2B tab.', [
              { text: 'OK', onPress: () => router.replace(`/profile/admin-vendor-booth-edit?id=${newId}` as any) },
            ]);
          } else throw error;
        } else {
          const newId = (data as { id: string }).id;
          Alert.alert('Saved', 'Vendor booth created. Assign meetings from the B2B tab (add the meeting time when you assign).', [
            { text: 'OK', onPress: () => router.replace(`/profile/admin-vendor-booth-edit?id=${newId}` as any) },
          ]);
        }
      } else {
        const payload: Record<string, unknown> = {
          vendor_name: vendorName.trim(),
          description: description.trim() || null,
          logo_url: logoUrl.trim() || null,
          booth_location: boothLocation.trim() || null,
          website: website.trim() || null,
          contact_user_id: contactUserId || null,
        };
        if (bannerUrl.trim()) payload.banner_url = bannerUrl.trim();
        const { error } = (await withSaveTimeout(Promise.resolve(client.from('vendor_booths').update(payload).eq('id', boothId)), 'Save booth')) as { error: { code?: string } | null };
        if (error) {
          const isBannerColumnMissing = (String(error.code) === '42703' || String(error.code) === 'PGRST204') && payload.banner_url;
          if (isBannerColumnMissing) {
            delete payload.banner_url;
            const retry = (await withSaveTimeout(Promise.resolve(client.from('vendor_booths').update(payload).eq('id', boothId)), 'Save booth')) as { error: unknown };
            if (retry.error) throw retry.error;
            Alert.alert('Saved', 'Vendor booth updated. Banner was not saved — banner_url column may need a moment to appear.');
          } else {
            throw error;
          }
        } else {
          Alert.alert('Saved', 'Vendor booth updated.');
        }
      }
    } catch (e: unknown) {
      console.error('Save booth error:', e);
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Could not save booth.';
      const hint = msg.includes('row-level security') || msg.includes('policy') || msg.includes('permission')
        ? ' Run supabase/RUN-THESE-MIGRATIONS.sql in Supabase SQL Editor to fix permissions.'
        : '';
      Alert.alert('Error', msg + hint);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !isNew) {
    return (
      <SafeAreaView style={s.container} edges={['bottom']}>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
        <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>Vendor name *</Text>
          <TextInput
            style={s.input}
            value={vendorName}
            onChangeText={setVendorName}
            placeholder="e.g. Acme Corp"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={s.label}>Description</Text>
          <TextInput
            style={[s.input, s.inputMultiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="Short description"
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <Text style={s.label}>Booth location</Text>
          <TextInput
            style={s.input}
            value={boothLocation}
            onChangeText={setBoothLocation}
            placeholder="e.g. Hall A, Stand 12"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={s.label}>Vendor representative</Text>
          <Text style={s.hint}>Select a community member for this event. They will see this booth and everyone they are meeting with.</Text>
          <TouchableOpacity
            style={s.dropdownTrigger}
            onPress={() => setRepDropdownVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={s.dropdownTriggerText} numberOfLines={1}>
              {contactUserId
                ? eventMembers.find((m) => m.user_id === contactUserId)?.full_name ?? 'Selected'
                : 'None'}
            </Text>
            <ChevronDown size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <Modal visible={repDropdownVisible} transparent animationType="fade">
            <Pressable style={s.modalOverlay} onPress={() => setRepDropdownVisible(false)}>
              <Pressable style={s.modalContent} onPress={(e) => e.stopPropagation()}>
                <Text style={s.modalTitle}>Vendor representative</Text>
                <FlatList
                  data={[{ user_id: '', full_name: 'None' }, ...eventMembers]}
                  keyExtractor={(item) => item.user_id || '__none__'}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={s.modalRow}
                      onPress={() => {
                        setContactUserId(item.user_id || null);
                        setRepDropdownVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={s.modalRowText} numberOfLines={1}>{item.full_name}</Text>
                    </TouchableOpacity>
                  )}
                />
              </Pressable>
            </Pressable>
          </Modal>
          <Text style={s.label}>Logo URL</Text>
          <TextInput
            style={s.input}
            value={logoUrl}
            onChangeText={setLogoUrl}
            placeholder="https://..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
          <Text style={s.label}>Banner image</Text>
          <Text style={s.hint}>Small banner shown on the booth card.</Text>
          <TouchableOpacity
            style={s.bannerTouchable}
            onPress={async () => {
              if (!currentEvent?.id || !user?.id) return;
              const uri = await pickImage('library');
              if (!uri) return;
              setUploadingBanner(true);
              try {
                const url = await uploadImage(uri, currentEvent.id, user.id, 'event-photos', { folder: 'vendor-banners' });
                if (url) {
                  setBannerUrl(url);
                  if (boothId) {
                    await supabase.from('vendor_booths').update({ banner_url: url }).eq('id', boothId);
                  }
                } else {
                  Alert.alert('Upload failed', 'Could not upload the image.');
                }
              } catch (e) {
                console.error('Banner upload error:', e);
                Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not upload.');
              } finally {
                setUploadingBanner(false);
              }
            }}
            disabled={uploadingBanner}
          >
            {bannerUrl ? (
              <Image source={{ uri: bannerUrl }} style={s.bannerPreview} resizeMode="cover" />
            ) : (
              <View style={s.bannerPlaceholder}>
                {uploadingBanner ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <ImagePlus size={32} color={colors.textMuted} />
                    <Text style={s.bannerPlaceholderText}>Tap to add banner</Text>
                  </>
                )}
              </View>
            )}
          </TouchableOpacity>
          {bannerUrl ? (
            <TouchableOpacity onPress={() => { setBannerUrl(''); if (boothId) supabase.from('vendor_booths').update({ banner_url: null }).eq('id', boothId); }} style={s.removeBannerBtn}>
              <Text style={s.removeBannerText}>Remove banner</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={s.label}>Website</Text>
          <TextInput
            style={s.input}
            value={website}
            onChangeText={setWebsite}
            placeholder="https://..."
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
          <TouchableOpacity style={s.saveBtn} onPress={handleSaveBooth} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveBtnText}>{isNew ? 'Create vendor booth' : 'Save changes'}</Text>}
          </TouchableOpacity>

          {!isNew && boothId && (
            <TouchableOpacity style={s.deleteBtn} onPress={handleDeleteBooth} disabled={saving}>
              <Text style={s.deleteBtnText}>Delete vendor booth</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4, marginTop: 12 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.text },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  saveBtn: { backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 24, minHeight: 48, justifyContent: 'center' },
  saveBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  hint: { fontSize: 14, color: colors.textSecondary, marginBottom: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  bannerTouchable: { marginTop: 4, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  bannerPreview: { width: '100%', height: 120 },
  bannerPlaceholder: { width: '100%', height: 120, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  bannerPlaceholderText: { marginTop: 8, fontSize: 14, color: colors.textMuted },
  removeBannerBtn: { marginTop: 8 },
  removeBannerText: { fontSize: 14, color: colors.danger },
  deleteBtn: { marginTop: 24, paddingVertical: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.danger },
  deleteBtnText: { fontSize: 16, fontWeight: '600', color: colors.danger },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 4,
    minHeight: 48,
  },
  dropdownTriggerText: { fontSize: 16, color: colors.text, flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: colors.surface, borderRadius: 12, maxHeight: 360 },
  modalTitle: { fontSize: 16, fontWeight: '600', color: colors.text, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalRow: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalRowText: { fontSize: 16, color: colors.text },
});
