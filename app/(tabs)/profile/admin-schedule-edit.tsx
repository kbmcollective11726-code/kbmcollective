import { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { format } from 'date-fns';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { colors } from '../../../constants/colors';
import { Calendar } from 'lucide-react-native';

const SESSION_TYPES = ['keynote', 'breakout', 'workshop', 'social', 'meal', 'networking', 'vendor'] as const;

const DAYS_AHEAD = 60;
const TIME_SLOTS = (() => {
  const out: Date[] = [];
  for (let h = 0; h < 24; h++) {
    out.push(new Date(2000, 0, 1, h, 0, 0));
    out.push(new Date(2000, 0, 1, h, 30, 0));
  }
  return out;
})();

function getDefaultStart(): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d;
}

function getDefaultEnd(): Date {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  return d;
}

function mergeDateAndTime(date: Date, timeSlot: Date): Date {
  const out = new Date(date);
  out.setHours(timeSlot.getHours(), timeSlot.getMinutes(), 0, 0);
  return out;
}

export default function AdminScheduleEditScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { currentEvent } = useEventStore();
  const isEdit = !!params.id;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [speakerName, setSpeakerName] = useState('');
  const [speakerTitle, setSpeakerTitle] = useState('');
  const [location, setLocation] = useState('');
  const [room, setRoom] = useState('');
  const [startDate, setStartDate] = useState<Date>(getDefaultStart);
  const [endDate, setEndDate] = useState<Date>(getDefaultEnd);
  const [pickerFor, setPickerFor] = useState<'start' | 'end' | null>(null);
  const [tempDate, setTempDate] = useState<Date>(getDefaultStart());
  const [tempTimeIndex, setTempTimeIndex] = useState(18); // 9:00
  const [dayNumber, setDayNumber] = useState('1');
  const [sessionType, setSessionType] = useState<typeof SESSION_TYPES[number]>('breakout');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const dateOptions = useMemo(() => {
    const out: Date[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      out.push(d);
    }
    return out;
  }, []);

  useEffect(() => {
    if (!isEdit || !params.id) return;
    (async () => {
      const { data, error } = await supabase
        .from('schedule_sessions')
        .select('*')
        .eq('id', params.id)
        .single();
      if (error || !data) {
        setLoading(false);
        return;
      }
      setTitle(data.title ?? '');
      setDescription(data.description ?? '');
      setSpeakerName(data.speaker_name ?? '');
      setSpeakerTitle(data.speaker_title ?? '');
      setLocation(data.location ?? '');
      setRoom(data.room ?? '');
      setStartDate(data.start_time ? new Date(data.start_time) : getDefaultStart());
      setEndDate(data.end_time ? new Date(data.end_time) : getDefaultEnd());
      setDayNumber(String(data.day_number ?? 1));
      setSessionType((data.session_type ?? 'breakout') as typeof SESSION_TYPES[number]);
      setLoading(false);
    })();
  }, [isEdit, params.id]);

  const openPicker = (which: 'start' | 'end') => {
    const value = which === 'start' ? startDate : endDate;
    setTempDate(new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0));
    const h = value.getHours();
    const m = value.getMinutes();
    setTempTimeIndex(m >= 30 ? h * 2 + 1 : h * 2);
    setPickerFor(which);
  };

  const applyPicker = () => {
    if (!pickerFor) return;
    const merged = mergeDateAndTime(tempDate, TIME_SLOTS[tempTimeIndex]!);
    if (pickerFor === 'start') setStartDate(merged);
    else setEndDate(merged);
    setPickerFor(null);
  };

  const handleSave = async () => {
    if (!currentEvent?.id || !title.trim()) {
      Alert.alert('Error', 'Title is required.');
      return;
    }
    const startTime = startDate.toISOString();
    const endTime = endDate.toISOString();
    if (endDate.getTime() <= startDate.getTime()) {
      Alert.alert('Error', 'End time must be after start time.');
      return;
    }
    const day = parseInt(dayNumber, 10);
    if (isNaN(day) || day < 1) {
      Alert.alert('Error', 'Day number must be 1 or more.');
      return;
    }

    setSaving(true);
    try {
      const row = {
        event_id: currentEvent.id,
        title: title.trim(),
        description: description.trim() || null,
        speaker_name: speakerName.trim() || null,
        speaker_title: speakerTitle.trim() || null,
        location: location.trim() || null,
        room: room.trim() || null,
        start_time: startTime,
        end_time: endTime,
        day_number: day,
        session_type: sessionType,
        is_active: true,
      };

      if (isEdit && params.id) {
        const { error } = await supabase.from('schedule_sessions').update(row).eq('id', params.id);
        if (error) throw error;
        Alert.alert('Saved', 'Session updated.', [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        const { error } = await supabase.from('schedule_sessions').insert(row);
        if (error) throw error;
        Alert.alert('Saved', 'Session added.', [{ text: 'OK', onPress: () => router.back() }]);
      }
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Title *</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Opening Keynote"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.area]}
          value={description}
          onChangeText={setDescription}
          placeholder="Optional description"
          placeholderTextColor={colors.textMuted}
          multiline
        />
        <Text style={styles.label}>Speaker name</Text>
        <TextInput
          style={styles.input}
          value={speakerName}
          onChangeText={setSpeakerName}
          placeholder="Optional"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.label}>Speaker title</Text>
        <TextInput
          style={styles.input}
          value={speakerTitle}
          onChangeText={setSpeakerTitle}
          placeholder="e.g. CEO"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.label}>Location / Room</Text>
        <TextInput
          style={styles.input}
          value={location}
          onChangeText={setLocation}
          placeholder="e.g. Main Hall"
          placeholderTextColor={colors.textMuted}
        />
        <TextInput
          style={styles.input}
          value={room}
          onChangeText={setRoom}
          placeholder="Room (e.g. 101)"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.label}>Start date & time *</Text>
        <TouchableOpacity style={styles.dateRow} onPress={() => openPicker('start')} activeOpacity={0.7}>
          <Calendar size={20} color={colors.primary} />
          <Text style={styles.dateRowText}>{format(startDate, 'EEE, MMM d, yyyy · h:mm a')}</Text>
        </TouchableOpacity>
        <Text style={styles.label}>End date & time *</Text>
        <TouchableOpacity style={styles.dateRow} onPress={() => openPicker('end')} activeOpacity={0.7}>
          <Calendar size={20} color={colors.primary} />
          <Text style={styles.dateRowText}>{format(endDate, 'EEE, MMM d, yyyy · h:mm a')}</Text>
        </TouchableOpacity>

        <Modal visible={pickerFor !== null} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>
                Pick {pickerFor === 'start' ? 'start' : 'end'} date & time
              </Text>
              <Text style={styles.modalSub}>Date</Text>
              <ScrollView style={styles.pickerScroll} nestedScrollEnabled>
                {dateOptions.map((d, i) => {
                  const isSelected =
                    d.getFullYear() === tempDate.getFullYear() &&
                    d.getMonth() === tempDate.getMonth() &&
                    d.getDate() === tempDate.getDate();
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.pickerRow, isSelected && styles.pickerRowSelected]}
                      onPress={() => setTempDate(d)}
                    >
                      <Text style={[styles.pickerRowText, isSelected && styles.pickerRowTextSelected]}>
                        {format(d, 'EEE, MMM d, yyyy')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <Text style={styles.modalSub}>Time</Text>
              <ScrollView style={styles.pickerScroll} nestedScrollEnabled>
                {TIME_SLOTS.map((t, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.pickerRow, tempTimeIndex === i && styles.pickerRowSelected]}
                    onPress={() => setTempTimeIndex(i)}
                  >
                    <Text
                      style={[
                        styles.pickerRowText,
                        tempTimeIndex === i && styles.pickerRowTextSelected,
                      ]}
                    >
                      {format(t, 'h:mm a')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setPickerFor(null)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalDoneBtn} onPress={applyPicker}>
                  <Text style={styles.modalDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Text style={styles.label}>Day number</Text>
        <TextInput
          style={styles.input}
          value={dayNumber}
          onChangeText={setDayNumber}
          placeholder="1"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
        />
        <Text style={styles.label}>Session type</Text>
        <View style={styles.typeRow}>
          {SESSION_TYPES.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.typeChip, sessionType === t && styles.typeChipActive]}
              onPress={() => setSessionType(t)}
            >
              <Text style={[styles.typeChipText, sessionType === t && styles.typeChipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveBtnText}>{isEdit ? 'Save changes' : 'Add session'}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 32 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 14, color: colors.textSecondary },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  area: { minHeight: 80, textAlignVertical: 'top' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: colors.surface,
  },
  dateRowText: { fontSize: 16, color: colors.text, flex: 1 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 16 },
  modalSub: { fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
  pickerScroll: { maxHeight: 140, marginBottom: 16 },
  pickerRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 4,
  },
  pickerRowSelected: { backgroundColor: colors.primary },
  pickerRowText: { fontSize: 16, color: colors.text },
  pickerRowTextSelected: { color: '#fff', fontWeight: '600' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalCancelBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  modalCancelText: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  modalDoneBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 12, backgroundColor: colors.primary },
  modalDoneText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 13, color: colors.textSecondary },
  typeChipTextActive: { color: '#fff', fontWeight: '600' },
  saveBtn: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
