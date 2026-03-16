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
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'lucide-react-native';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';

function toYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalYYYYMMDD(s: string): Date | null {
  const trimmed = s.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  if (m < 0 || m > 11 || day < 1 || day > 31) return null;
  const date = new Date(y, m, day);
  if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== day) return null;
  return date;
}

export default function AdminEventEditScreen() {
  const { currentEvent, setCurrentEvent } = useEventStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [themeColor, setThemeColor] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const startDateObj = startDate ? (parseLocalYYYYMMDD(startDate) ?? new Date()) : new Date();
  const endDateObj = endDate ? (parseLocalYYYYMMDD(endDate) ?? new Date()) : new Date();
  const minEndDate = startDate ? (parseLocalYYYYMMDD(startDate) ?? startDateObj) : new Date();

  useEffect(() => {
    if (currentEvent) {
      setName(currentEvent.name);
      setDescription(currentEvent.description ?? '');
      setLocation(currentEvent.location ?? '');
      setVenue(currentEvent.venue ?? '');
      setStartDate(currentEvent.start_date ?? '');
      setEndDate(currentEvent.end_date ?? '');
      setThemeColor(currentEvent.theme_color ?? '#2563eb');
      setWelcomeMessage(currentEvent.welcome_message ?? '');
      setEventCode(currentEvent.event_code ?? '');
    }
  }, [currentEvent?.id]);

  const handleSave = async () => {
    if (!currentEvent?.id || !name.trim()) {
      Alert.alert('Error', 'Event name is required.');
      return;
    }
    if (!startDate.trim() || !endDate.trim()) {
      Alert.alert('Error', 'Start date and end date are required.');
      return;
    }
    const startD = parseLocalYYYYMMDD(startDate);
    const endD = parseLocalYYYYMMDD(endDate);
    if (!startD || !endD) {
      Alert.alert('Error', 'Dates must be in YYYY-MM-DD format.');
      return;
    }
    if (endD.getTime() < startD.getTime()) {
      Alert.alert('Error', 'End date must be on or after the start date.');
      return;
    }
    setSaving(true);
    try {
      const customCode = eventCode.trim() ? eventCode.trim().toUpperCase() : null;
      const { data, error } = await supabase
        .from('events')
        .update({
          name: name.trim(),
          description: description.trim() || null,
          location: location.trim() || null,
          venue: venue.trim() || null,
          start_date: startDate.trim(),
          end_date: endDate.trim(),
          theme_color: themeColor.trim() || '#2563eb',
          welcome_message: welcomeMessage.trim() || null,
          event_code: customCode ?? currentEvent.event_code,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentEvent.id)
        .select()
        .single();
      if (error) throw error;
      if (data) setCurrentEvent(data as typeof currentEvent);
      Alert.alert('Saved', 'Event updated.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save.';
      if (typeof (err as { code?: string })?.code === 'string' && (err as { code: string }).code === '23505') {
        Alert.alert('Error', 'That event code is already in use. Choose another.');
      } else {
        Alert.alert('Error', msg);
      }
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <Text style={styles.label}>Event name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Event name" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Description</Text>
        <TextInput style={[styles.input, styles.area]} value={description} onChangeText={setDescription} placeholder="Description" placeholderTextColor={colors.textMuted} multiline />
        <Text style={styles.label}>Location</Text>
        <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Address or city" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Venue</Text>
        <TextInput style={styles.input} value={venue} onChangeText={setVenue} placeholder="e.g. Westgate Resort" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Event code</Text>
        <TextInput style={styles.input} value={eventCode} onChangeText={setEventCode} placeholder="e.g. SUMMIT26" placeholderTextColor={colors.textMuted} autoCapitalize="characters" autoCorrect={false} />
        <Text style={styles.label}>Start date</Text>
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
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(_, date) => {
                if (Platform.OS === 'android') setShowStartPicker(false);
                if (date) setStartDate(toYYYYMMDD(date));
              }}
              {...(Platform.OS === 'ios' && {
                themeVariant: 'light' as const,
                accentColor: colors.primary,
              })}
            />
          </>
        )}
        <Text style={styles.label}>End date</Text>
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
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              minimumDate={minEndDate}
              onChange={(_, date) => {
                if (Platform.OS === 'android') setShowEndPicker(false);
                if (date) setEndDate(toYYYYMMDD(date));
              }}
              {...(Platform.OS === 'ios' && {
                themeVariant: 'light' as const,
                accentColor: colors.primary,
              })}
            />
          </>
        )}
        <Text style={styles.label}>Theme color (hex)</Text>
        <TextInput style={styles.input} value={themeColor} onChangeText={setThemeColor} placeholder="#2563eb" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Welcome message</Text>
        <TextInput style={[styles.input, styles.area]} value={welcomeMessage} onChangeText={setWelcomeMessage} placeholder="Shown on Info tab" placeholderTextColor={colors.textMuted} multiline />
        <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.textOnPrimary} size="small" /> : <Text style={styles.buttonText}>Save</Text>}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 14, color: colors.textSecondary },
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
