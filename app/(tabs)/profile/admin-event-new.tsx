import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Calendar } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { initializePointRules } from '../../../lib/points';
import { colors } from '../../../constants/colors';
import type { Event } from '../../../lib/types';

function toYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function AdminEventNewScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { setCurrentEvent, fetchMyMemberships } = useEventStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [themeColor, setThemeColor] = useState('#2563eb');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const startDateObj = startDate ? (() => { const d = new Date(startDate); return isNaN(d.getTime()) ? new Date() : d; })() : new Date();
  const endDateObj = endDate ? (() => { const d = new Date(endDate); return isNaN(d.getTime()) ? new Date() : d; })() : new Date();

  const handleCreate = async () => {
    if (!user?.id) {
      Alert.alert('Error', 'You must be logged in to create an event.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Error', 'Event name is required.');
      return;
    }
    if (!startDate.trim() || !endDate.trim()) {
      Alert.alert('Error', 'Start date and end date are required (YYYY-MM-DD).');
      return;
    }
    const customCode = eventCode.trim() ? eventCode.trim().toUpperCase() : null;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('events')
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          location: location.trim() || null,
          venue: venue.trim() || null,
          start_date: startDate.trim(),
          end_date: endDate.trim(),
          theme_color: themeColor.trim() || '#2563eb',
          welcome_message: welcomeMessage.trim() || null,
          event_code: customCode,
          created_by: user.id,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      const event = data as Event;
      await initializePointRules(event.id);
      await fetchMyMemberships(user.id);
      await setCurrentEvent(event);
      Alert.alert('Created', `Event "${event.name}" created. Share event code: ${event.event_code ?? '—'}`, [
        { text: 'Edit info page', onPress: () => router.push('/profile/admin-info-page') },
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create event.';
      if (typeof (err as { code?: string })?.code === 'string' && (err as { code: string }).code === '23505') {
        Alert.alert('Error', 'That event code is already in use. Choose another or leave blank for auto-generated.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create new event</Text>
        <Text style={styles.label}>Event name *</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Front Office Summit 2025" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Description</Text>
        <TextInput style={[styles.input, styles.area]} value={description} onChangeText={setDescription} placeholder="Short description" placeholderTextColor={colors.textMuted} multiline />
        <Text style={styles.label}>Location</Text>
        <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Address or city" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Venue</Text>
        <TextInput style={styles.input} value={venue} onChangeText={setVenue} placeholder="e.g. Westgate Resort" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Event code (optional)</Text>
        <TextInput style={styles.input} value={eventCode} onChangeText={setEventCode} placeholder="e.g. SUMMIT26 — leave blank for auto" placeholderTextColor={colors.textMuted} autoCapitalize="characters" autoCorrect={false} />
        <Text style={styles.label}>Start date *</Text>
        <TouchableOpacity style={styles.dateRow} onPress={() => setShowStartPicker(true)} activeOpacity={0.7}>
          <Calendar size={20} color={colors.primary} />
          <Text style={styles.dateRowText}>{startDate || 'Tap to pick date'}</Text>
        </TouchableOpacity>
        {showStartPicker && (
          <>
            {Platform.OS === 'ios' && (
              <TouchableOpacity onPress={() => setShowStartPicker(false)} style={styles.pickerDone}>
                <Text style={styles.pickerDoneText}>Done</Text>
              </TouchableOpacity>
            )}
            <DateTimePicker
              value={startDateObj}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, date) => {
                if (Platform.OS === 'android') setShowStartPicker(false);
                if (date) setStartDate(toYYYYMMDD(date));
              }}
            />
          </>
        )}
        <Text style={styles.label}>End date *</Text>
        <TouchableOpacity style={styles.dateRow} onPress={() => setShowEndPicker(true)} activeOpacity={0.7}>
          <Calendar size={20} color={colors.primary} />
          <Text style={styles.dateRowText}>{endDate || 'Tap to pick date'}</Text>
        </TouchableOpacity>
        {showEndPicker && (
          <>
            {Platform.OS === 'ios' && (
              <TouchableOpacity onPress={() => setShowEndPicker(false)} style={styles.pickerDone}>
                <Text style={styles.pickerDoneText}>Done</Text>
              </TouchableOpacity>
            )}
            <DateTimePicker
              value={endDateObj}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, date) => {
                if (Platform.OS === 'android') setShowEndPicker(false);
                if (date) setEndDate(toYYYYMMDD(date));
              }}
            />
          </>
        )}
        <Text style={styles.label}>Theme color (hex)</Text>
        <TextInput style={styles.input} value={themeColor} onChangeText={setThemeColor} placeholder="#2563eb" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Welcome message</Text>
        <TextInput style={[styles.input, styles.area]} value={welcomeMessage} onChangeText={setWelcomeMessage} placeholder="Shown on Info tab" placeholderTextColor={colors.textMuted} multiline />
        <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleCreate} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.textOnPrimary} size="small" /> : <Text style={styles.buttonText}>Create event</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: colors.text, marginBottom: 20 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 20 },
  dateRowText: { fontSize: 16, color: colors.text, flex: 1 },
  pickerDone: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 16, marginBottom: 8 },
  pickerDoneText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  area: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { fontSize: 16, fontWeight: '600', color: colors.textOnPrimary },
});
