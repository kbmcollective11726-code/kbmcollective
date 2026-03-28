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
  const [boothLocation, setBoothLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [contactUserId, setContactUserId] = useState<string | null>(null);
  const [repUserIds, setRepUserIds] = useState<string[]>([]);
  const [eventMembers, setEventMembers] = useState<{ user_id: string; full_name: string }[]>([]);
  const [repDropdownVisible, setRepDropdownVisible] = useState(false);
  const [multiRepVisible, setMultiRepVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
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
      const b = data as VendorBooth;
      setVendorName(b.vendor_name ?? '');
      setDescription(b.description ?? '');
      setLogoUrl(b.logo_url ?? '');
      setBoothLocation(b.booth_location ?? '');
      setWebsite(b.website ?? '');
      setContactUserId(b.contact_user_id ?? null);
      const repsRes = await client.from('vendor_booth_reps').select('user_id').eq('booth_id', boothId);
      if (!repsRes.error) {
        setRepUserIds((repsRes.data ?? []).map((r: { user_id: string }) => r.user_id));
      } else {
        setRepUserIds(b.contact_user_id ? [b.contact_user_id] : []);
      }
    } catch (e) {
      if (__DEV__) console.error('Fetch booth error:', e);
      Alert.alert('Error', 'Could not load booth. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [boothId, router]);

  const syncBoothReps = useCallback(
    async (targetBoothId: string) => {
      const uniqueRepIds = [...new Set(repUserIds.filter(Boolean))];
      const client = Platform.OS === 'android' ? supabaseStorage : supabase;
      const { error: delErr } = await client.from('vendor_booth_reps').delete().eq('booth_id', targetBoothId);
      if (delErr) throw delErr;
      if (uniqueRepIds.length > 0) {
        const rows = uniqueRepIds.map((uid) => ({ booth_id: targetBoothId, user_id: uid }));
        const { error: insErr } = await client.from('vendor_booth_reps').insert(rows);
        if (insErr) throw insErr;
      }
    },
    [repUserIds]
  );

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
        const { data, error } = (await withSaveTimeout(
          Promise.resolve(client.from('vendor_booths').insert(payload).select('id').single()),
          'Save booth'
        )) as { data: { id: string } | null; error: unknown };
        if (error) throw error;
        const newId = (data as { id: string }).id;
        await syncBoothReps(newId);
        Alert.alert('Saved', 'Vendor booth created. Assign meetings from the B2B tab (add the meeting time when you assign).', [
          { text: 'OK', onPress: () => router.replace(`/profile/admin-vendor-booth-edit?id=${newId}` as any) },
        ]);
      } else {
        const payload: Record<string, unknown> = {
          vendor_name: vendorName.trim(),
          description: description.trim() || null,
          logo_url: logoUrl.trim() || null,
          booth_location: boothLocation.trim() || null,
          website: website.trim() || null,
          contact_user_id: contactUserId || null,
        };
        const { error } = (await withSaveTimeout(Promise.resolve(client.from('vendor_booths').update(payload).eq('id', boothId)), 'Save booth')) as { error: unknown };
        if (error) throw error;
        if (boothId) await syncBoothReps(boothId);
        Alert.alert('Saved', 'Vendor booth updated.');
      }
    } catch (e: unknown) {
      console.error('Save booth error:', e);
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Could not save booth.';
      const hint =
        msg.includes('row-level security') || msg.includes('policy') || msg.includes('permission') || msg.includes('403')
          ? ' You must be event admin or platform admin. Run migration 20260327130000_vendor_booths_rls_fix.sql in Supabase SQL Editor if needed.'
          : msg.includes('vendor_booth_reps') || msg.includes('42P01') || msg.includes('does not exist')
            ? ' Apply migration 20260326090000_vendor_booth_multi_reps.sql (vendor_booth_reps table) in Supabase SQL Editor.'
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
          <Text style={s.label}>Primary representative</Text>
          <Text style={s.hint}>Primary contact for this booth.</Text>
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
          <Text style={s.label}>Additional representatives</Text>
          <Text style={s.hint}>You can assign multiple reps to the same booth.</Text>
          <TouchableOpacity
            style={s.dropdownTrigger}
            onPress={() => setMultiRepVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={s.dropdownTriggerText} numberOfLines={1}>
              {repUserIds.length > 0 ? `${repUserIds.length} selected` : 'None'}
            </Text>
            <ChevronDown size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <Modal visible={multiRepVisible} transparent animationType="fade">
            <Pressable style={s.modalOverlay} onPress={() => setMultiRepVisible(false)}>
              <Pressable style={s.modalContent} onPress={(e) => e.stopPropagation()}>
                <Text style={s.modalTitle}>Additional representatives</Text>
                <FlatList
                  data={eventMembers}
                  keyExtractor={(item) => item.user_id}
                  renderItem={({ item }) => {
                    const checked = repUserIds.includes(item.user_id);
                    return (
                      <TouchableOpacity
                        style={s.modalRow}
                        onPress={() => {
                          setRepUserIds((prev) => {
                            if (checked) return prev.filter((id) => id !== item.user_id);
                            return [...new Set([...prev, item.user_id])];
                          });
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={s.modalRowText} numberOfLines={1}>
                          {checked ? '✓ ' : ''}{item.full_name}
                        </Text>
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={<Text style={[s.modalRowText, { padding: 16 }]}>No members available.</Text>}
                />
                <TouchableOpacity style={s.saveBtn} onPress={() => setMultiRepVisible(false)}>
                  <Text style={s.saveBtnText}>Done</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>
          <Text style={s.label}>Logo image</Text>
          <Text style={s.hint}>Square or wide logo shown on booth cards. Tap to choose from your library.</Text>
          <TouchableOpacity
            style={s.logoTouchable}
            onPress={async () => {
              if (!currentEvent?.id || !user?.id) return;
              const uri = await pickImage('library');
              if (!uri) return;
              setUploadingLogo(true);
              try {
                const url = await uploadImage(uri, currentEvent.id, user.id, 'event-photos', { folder: 'vendor-logos' });
                if (url) {
                  setLogoUrl(url);
                  if (boothId) {
                    await supabase.from('vendor_booths').update({ logo_url: url }).eq('id', boothId);
                  }
                } else {
                  Alert.alert('Upload failed', 'Could not upload the image.');
                }
              } catch (e) {
                console.error('Logo upload error:', e);
                Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not upload.');
              } finally {
                setUploadingLogo(false);
              }
            }}
            disabled={uploadingLogo}
          >
            {logoUrl ? (
              <Image source={{ uri: logoUrl }} style={s.logoPreview} resizeMode="contain" />
            ) : (
              <View style={s.logoPlaceholder}>
                {uploadingLogo ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <ImagePlus size={28} color={colors.textMuted} />
                    <Text style={s.logoPlaceholderText}>Tap to add logo</Text>
                  </>
                )}
              </View>
            )}
          </TouchableOpacity>
          {logoUrl ? (
            <TouchableOpacity
              onPress={() => {
                setLogoUrl('');
                if (boothId) supabase.from('vendor_booths').update({ logo_url: null }).eq('id', boothId);
              }}
              style={s.removeImageBtn}
            >
              <Text style={s.removeImageText}>Remove logo</Text>
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
  logoTouchable: {
    marginTop: 4,
    alignSelf: 'flex-start',
    width: 120,
    height: 120,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  logoPreview: { width: '100%', height: '100%' },
  logoPlaceholder: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', padding: 8 },
  logoPlaceholderText: { marginTop: 6, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  removeImageBtn: { marginTop: 8 },
  removeImageText: { fontSize: 14, color: colors.danger },
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
