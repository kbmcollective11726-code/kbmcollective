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
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { createNotificationAndPush } from '../../../lib/notifications';
import { sendAnnouncementPush } from '../../../lib/pushNotifications';
import { colors } from '../../../constants/colors';
import { Calendar, UserPlus, X, Download, Upload } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const TEMPLATE_DOWNLOAD_DIR_KEY = '@schedule_template_download_dir';

type MemberOption = { user_id: string; full_name: string; title: string | null; company: string | null; role: string };
type SpeakerEntry = { name: string; title: string; company: string };

const SESSION_TYPES = ['keynote', 'breakout', 'workshop', 'social', 'meal', 'networking', 'vendor'] as const;

const TIME_SLOTS = (() => {
  const out: Date[] = [];
  for (let h = 0; h < 24; h++) {
    out.push(new Date(2000, 0, 1, h, 0, 0));
    out.push(new Date(2000, 0, 1, h, 15, 0));
    out.push(new Date(2000, 0, 1, h, 30, 0));
    out.push(new Date(2000, 0, 1, h, 45, 0));
  }
  return out;
})();

/** Parse YYYY-MM-DD as local date. */
function parseEventDate(s: string): Date {
  const parts = s.trim().split('-').map(Number);
  if (parts.length !== 3) return new Date();
  const [y, m, day] = parts;
  const d = new Date(y, (m ?? 1) - 1, day ?? 1);
  return isNaN(d.getTime()) ? new Date() : d;
}

function getDefaultStart(eventStartDate?: string): Date {
  const d = eventStartDate ? parseEventDate(eventStartDate) : new Date();
  d.setHours(9, 0, 0, 0);
  return d;
}

function getDefaultEnd(eventStartDate?: string): Date {
  const d = eventStartDate ? parseEventDate(eventStartDate) : new Date();
  d.setHours(10, 0, 0, 0);
  return d;
}

function mergeDateAndTime(date: Date, timeSlot: Date): Date {
  const out = new Date(date);
  out.setHours(timeSlot.getHours(), timeSlot.getMinutes(), 0, 0);
  return out;
}

/** Escape CSV field (quote if contains comma, newline, or quote). */
function csvEscape(s: string): string {
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Parse a single CSV row (handles quoted fields). */
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let val = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { val += '"'; i += 2; } else { i++; break; }
        } else { val += line[i]; i++; }
      }
      out.push(val);
    } else {
      const comma = line.indexOf(',', i);
      const end = comma === -1 ? line.length : comma;
      out.push(line.slice(i, end).trim());
      i = comma === -1 ? line.length : comma + 1;
    }
  }
  return out;
}

const CSV_HEADERS = ['title', 'description', 'speaker_name', 'speaker_title', 'speaker_company', 'location', 'room', 'start_date', 'start_time', 'end_date', 'end_time', 'session_type'] as const;

export default function AdminScheduleEditScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const isEdit = !!params.id;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [speakers, setSpeakers] = useState<SpeakerEntry[]>([]);
  const [location, setLocation] = useState('');
  const [room, setRoom] = useState('');
  const [startDate, setStartDate] = useState<Date>(getDefaultStart);
  const [endDate, setEndDate] = useState<Date>(getDefaultEnd);
  const [pickerFor, setPickerFor] = useState<'start' | 'end' | null>(null);
  const [tempDate, setTempDate] = useState<Date>(getDefaultStart());
  const [tempTimeIndex, setTempTimeIndex] = useState(36); // 9:00 (15-min slots: 9*4=36)
  const [sessionTypes, setSessionTypes] = useState<string[]>(['breakout']);
  const [customTypeInput, setCustomTypeInput] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [showSpeakerPicker, setShowSpeakerPicker] = useState(false);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);
  const [downloadTemplateBusy, setDownloadTemplateBusy] = useState(false);

  const dateOptions = useMemo(() => {
    const out: Date[] = [];
    const start = currentEvent?.start_date
      ? parseEventDate(currentEvent.start_date)
      : new Date();
    const end = currentEvent?.end_date
      ? parseEventDate(currentEvent.end_date)
      : (() => { const e = new Date(); e.setDate(e.getDate() + 59); return e; })();
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
    for (let i = 0; i <= diffDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0));
    }
    if (out.length === 0) {
      const fallback = new Date();
      fallback.setHours(0, 0, 0, 0);
      out.push(fallback);
    }
    return out;
  }, [currentEvent?.start_date, currentEvent?.end_date]);

  // Day number auto-calculated from session start date vs event start_date
  const computedDayNumber = useMemo(() => {
    if (!currentEvent?.start_date || currentEvent.start_date.length < 10) return 1;
    const eventStartKey = currentEvent.start_date.slice(0, 10);
    const sessionStartKey = format(startDate, 'yyyy-MM-dd');
    const start = parseISO(eventStartKey);
    const session = parseISO(sessionStartKey);
    if (Number.isNaN(start.getTime()) || Number.isNaN(session.getTime())) return 1;
    const diffMs = session.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
    return Math.max(1, diffDays + 1);
  }, [currentEvent?.start_date, startDate]);

  // When adding new session, default date to event start date
  useEffect(() => {
    if (!isEdit && currentEvent?.start_date) {
      const start = getDefaultStart(currentEvent.start_date);
      const end = getDefaultEnd(currentEvent.start_date);
      setStartDate(start);
      setEndDate(end);
    }
  }, [isEdit, currentEvent?.start_date]);

  useEffect(() => {
    if (!isEdit || !params.id || !currentEvent?.id) return;
    (async () => {
      const { data, error } = await supabase
        .from('schedule_sessions')
        .select('*')
        .eq('id', params.id)
        .eq('event_id', currentEvent.id)
        .single();
      if (error || !data) {
        setLoading(false);
        return;
      }
      setTitle(data.title ?? '');
      setDescription(data.description ?? '');
      const rawSpeakers = data.speakers;
      if (Array.isArray(rawSpeakers) && rawSpeakers.length > 0) {
        setSpeakers(
          rawSpeakers.map((s: { name?: string; title?: string; company?: string | null }) => ({
            name: s?.name ?? '',
            title: s?.title ?? '',
            company: s?.company ?? '',
          }))
        );
      } else if (data.speaker_name || data.speaker_title) {
        setSpeakers([{ name: data.speaker_name ?? '', title: data.speaker_title ?? '', company: '' }]);
      } else {
        setSpeakers([]);
      }
      setLocation(data.location ?? '');
      setRoom(data.room ?? '');
      const start = data.start_time ? new Date(data.start_time) : getDefaultStart();
      setStartDate(start);
      setEndDate(data.end_time ? new Date(data.end_time) : getDefaultEnd());
      // Session types: support comma-separated for multiple
      const types = (data.session_type ?? 'breakout').toString().split(',').map((t: string) => t.trim()).filter(Boolean);
      setSessionTypes(types.length > 0 ? types : ['breakout']);
      setLoading(false);
    })();
  }, [isEdit, params.id, currentEvent?.id, currentEvent?.start_date]);

  useEffect(() => {
    if (!currentEvent?.id || !showSpeakerPicker) return;
    (async () => {
      const { data } = await supabase
        .from('event_members')
        .select('user_id, role, users!inner(full_name, title, company)')
        .eq('event_id', currentEvent.id);
      if (data) {
        const rows = data as unknown as { user_id: string; role: string; users: { full_name: string; title?: string | null; company?: string | null } }[];
        setMemberOptions(
          rows.map((r) => ({
            user_id: r.user_id,
            full_name: r.users?.full_name ?? 'Unknown',
            title: r.users?.title ?? null,
            company: r.users?.company ?? null,
            role: r.role,
          }))
        );
      }
    })();
  }, [currentEvent?.id, showSpeakerPicker]);

  const handleDownloadTemplate = async () => {
    if (downloadTemplateBusy) return;
    setDownloadTemplateBusy(true);
    try {
      const eventStart = currentEvent?.start_date ?? format(new Date(), 'yyyy-MM-dd');
      const row = [
        csvEscape('Opening Keynote'),
        csvEscape('Welcome session'),
        csvEscape('Speaker Name'),
        csvEscape('CEO'),
        csvEscape('Company Inc'),
        csvEscape('Main Hall'),
        csvEscape('101'),
        eventStart,
        '09:00',
        eventStart,
        '10:00',
        'keynote',
      ].join(',');
      const csv = [CSV_HEADERS.join(','), row].join('\n');

      if (Platform.OS === 'android') {
        try {
          const { StorageAccessFramework } = FileSystem;
          let dirUri: string | null = null;
          try {
            dirUri = await AsyncStorage.getItem(TEMPLATE_DOWNLOAD_DIR_KEY);
          } catch {
            // ignore
          }
          const trySaveToDir = async (directoryUri: string): Promise<boolean> => {
            try {
              const fileUri = await StorageAccessFramework.createFileAsync(
                directoryUri,
                'session-template',
                'text/csv'
              );
              await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
              return true;
            } catch {
              return false;
            }
          };
          if (dirUri && (await trySaveToDir(dirUri))) {
            Alert.alert('Saved', 'Session template saved to your chosen folder (e.g. Downloads).');
            setDownloadTemplateBusy(false);
            return;
          }
          const downloadsUri = StorageAccessFramework.getUriForDirectoryInRoot('Download');
          const result = await StorageAccessFramework.requestDirectoryPermissionsAsync(downloadsUri);
          if (result.granted && result.directoryUri) {
            await AsyncStorage.setItem(TEMPLATE_DOWNLOAD_DIR_KEY, result.directoryUri);
            if (await trySaveToDir(result.directoryUri)) {
              Alert.alert('Saved', 'Session template saved to your chosen folder. Future downloads will go to the same folder.');
              setDownloadTemplateBusy(false);
              return;
            }
          }
        } catch {
          // SAF not available or failed; fall through to share sheet
        }
      }

      const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
      const baseDir = dir && !dir.endsWith('/') ? `${dir}/` : dir;
      const path = `${baseDir}session-template.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(path, {
          mimeType: 'text/csv',
          dialogTitle: 'Save session template',
          UTI: 'public.comma-separated-values-text',
        });
        if (Platform.OS === 'ios') {
          Alert.alert('Save to device', 'Choose "Save to Files" or "Save to device" in the share sheet to save the template to your device.');
        }
      } else {
        Alert.alert(
          'Template ready',
          'The template was saved. On this device you can find it in the app cache, or use "Upload CSV" after moving the file from another device.'
        );
      }
    } catch (err) {
      Alert.alert(
        'Download failed',
        err instanceof Error ? err.message : 'Could not create or share the template. Try again.'
      );
    } finally {
      setDownloadTemplateBusy(false);
    }
  };

  const handleUploadCSV = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'text/csv',
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const text = await FileSystem.readAsStringAsync(res.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 });
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        Alert.alert('Invalid file', 'CSV must have a header row and at least one data row.');
        return;
      }
      const headers = parseCsvRow(lines[0] ?? '');
      const values = parseCsvRow(lines[1] ?? '');
      const row: Record<string, string> = {};
      CSV_HEADERS.forEach((h, i) => { row[h] = (values[i] ?? '').trim(); });
      setTitle(row.title || '');
      setDescription(row.description || '');
      setSpeakers(
        row.speaker_name ? [{ name: row.speaker_name, title: row.speaker_title || '', company: row.speaker_company || '' }] : []
      );
      setLocation(row.location || '');
      setRoom(row.room || '');
      if (row.start_date && row.start_time) {
        const [yh, mh, dh] = row.start_date.split('-').map(Number);
        const [th, tm] = row.start_time.split(':').map(Number);
        const start = new Date(yh, (mh ?? 1) - 1, dh ?? 1, th ?? 9, tm ?? 0, 0, 0);
        setStartDate(start);
      }
      if (row.end_date && row.end_time) {
        const [yh, mh, dh] = row.end_date.split('-').map(Number);
        const [th, tm] = row.end_time.split(':').map(Number);
        const end = new Date(yh, (mh ?? 1) - 1, dh ?? 1, th ?? 10, tm ?? 0, 0, 0);
        setEndDate(end);
      }
      if (row.session_type) {
        const types = row.session_type.split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean);
        setSessionTypes(types.length > 0 ? types : ['breakout']);
      }
      Alert.alert('Imported', 'Session data loaded from CSV. Review and save.');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to read file.');
    }
  };

  const openPicker = (which: 'start' | 'end') => {
    const value = which === 'start' ? startDate : endDate;
    setTempDate(new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0));
    const h = value.getHours();
    const m = value.getMinutes();
    const slot = Math.floor(m / 15);
    setTempTimeIndex(Math.min(h * 4 + slot, TIME_SLOTS.length - 1));
    setPickerFor(which);
  };

  const applyPicker = () => {
    if (!pickerFor) return;
    const merged = mergeDateAndTime(tempDate, TIME_SLOTS[tempTimeIndex]!);
    if (pickerFor === 'start') {
      setStartDate(merged);
      // Default end to 1 hour after start when user sets start time
      const endOneHourLater = new Date(merged.getTime() + 60 * 60 * 1000);
      setEndDate(endOneHourLater);
    } else {
      setEndDate(merged);
    }
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
    const sessionTypeValue = sessionTypes.length > 0 ? sessionTypes.join(',') : 'breakout';
    const speakersFiltered = speakers
      .filter((s) => s.name.trim())
      .map((s) => ({ name: s.name.trim(), title: s.title.trim() || '', company: s.company.trim() || '' }));
    const firstSpeaker = speakersFiltered[0];

    setSaving(true);
    try {
      const row = {
        event_id: currentEvent.id,
        title: title.trim(),
        description: description.trim() || null,
        speakers: speakersFiltered.length > 0 ? speakersFiltered : null,
        speaker_name: firstSpeaker?.name || null,
        speaker_title: firstSpeaker?.title || null,
        location: location.trim() || null,
        room: room.trim() || null,
        start_time: startTime,
        end_time: endTime,
        day_number: computedDayNumber,
        session_type: sessionTypeValue,
        is_active: true,
      };

      if (isEdit && params.id) {
        const { error } = await supabase.from('schedule_sessions').update(row).eq('id', params.id);
        if (error) throw error;
        // Notify event members of schedule change (in-app + push)
        const notifTitle = 'Schedule updated';
        const notifBody = `"${title.trim()}" was updated. Check the Schedule tab for details.`;
        const { data: members } = await supabase
          .from('event_members')
          .select('user_id')
          .eq('event_id', currentEvent.id);
        const recipientIds = (members ?? [])
          .map((m: { user_id: string }) => m.user_id)
          .filter((id: string) => id !== user?.id);
        for (const uid of recipientIds) {
          await createNotificationAndPush(
            uid,
            currentEvent.id,
            'schedule_change',
            notifTitle,
            notifBody,
            { session_id: params.id }
          );
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token && recipientIds.length > 0) {
          sendAnnouncementPush(
            session.access_token,
            currentEvent.id,
            notifTitle,
            notifBody,
            recipientIds
          ).catch(() => {});
        }
        Alert.alert('Saved', 'Session updated.', [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        const { data: inserted, error } = await supabase.from('schedule_sessions').insert(row).select('id').single();
        if (error) throw error;
        // Notify event members of new session (in-app + push)
        const notifTitle = 'New session added';
        const notifBody = `"${title.trim()}" was added to the schedule. Check the Schedule tab.`;
        const { data: members } = await supabase
          .from('event_members')
          .select('user_id')
          .eq('event_id', currentEvent.id);
        const recipientIds = (members ?? [])
          .map((m: { user_id: string }) => m.user_id)
          .filter((id: string) => id !== user?.id);
        for (const uid of recipientIds) {
          await createNotificationAndPush(
            uid,
            currentEvent.id,
            'schedule_change',
            notifTitle,
            notifBody,
            { session_id: inserted?.id }
          );
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token && recipientIds.length > 0) {
          sendAnnouncementPush(session.access_token, currentEvent.id, notifTitle, notifBody, recipientIds).catch(() => {});
        }
        Alert.alert('Saved', 'Session added.', [{ text: 'OK', onPress: () => router.back() }]);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof (err as { message?: string })?.message === 'string'
            ? (err as { message: string }).message
            : 'Failed to save.';
      if (__DEV__ && err) console.error('Schedule save error:', err);
      Alert.alert('Error', message);
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <View style={styles.csvRow}>
          <TouchableOpacity
            style={[styles.csvBtn, downloadTemplateBusy && styles.csvBtnDisabled]}
            onPress={handleDownloadTemplate}
            disabled={downloadTemplateBusy}
          >
            {downloadTemplateBusy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Download size={18} color={colors.primary} />
            )}
            <Text style={styles.csvBtnText}>{downloadTemplateBusy ? 'Preparing…' : 'Download template'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.csvBtn} onPress={handleUploadCSV}>
            <Upload size={18} color={colors.primary} />
            <Text style={styles.csvBtnText}>Upload CSV</Text>
          </TouchableOpacity>
        </View>
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
        <View style={styles.labelRow}>
          <Text style={styles.label}>Speakers</Text>
          <View style={styles.speakerAddRow}>
            <TouchableOpacity style={styles.tagMemberBtn} onPress={() => setShowSpeakerPicker(true)} disabled={!currentEvent?.id}>
              <UserPlus size={18} color={colors.primary} />
              <Text style={styles.tagMemberText}>Tag member</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tagMemberBtn, { marginLeft: 8 }]}
              onPress={() => setSpeakers((prev) => [...prev, { name: '', title: '', company: '' }])}
            >
              <Text style={styles.tagMemberText}>+ Add row</Text>
            </TouchableOpacity>
          </View>
        </View>
        {speakers.map((s, idx) => (
          <View key={idx} style={styles.speakerRow}>
            <View style={styles.speakerInfo}>
              <TextInput
                style={[styles.input, styles.speakerInput]}
                value={s.name}
                onChangeText={(v) =>
                  setSpeakers((prev) => prev.map((x, i) => (i === idx ? { ...x, name: v } : x)))
                }
                placeholder="Name"
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={[styles.input, styles.speakerInput]}
                value={s.title}
                onChangeText={(v) =>
                  setSpeakers((prev) => prev.map((x, i) => (i === idx ? { ...x, title: v } : x)))
                }
                placeholder="Title (e.g. CEO)"
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={[styles.input, styles.speakerInput]}
                value={s.company}
                onChangeText={(v) =>
                  setSpeakers((prev) => prev.map((x, i) => (i === idx ? { ...x, company: v } : x)))
                }
                placeholder="Company"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <TouchableOpacity onPress={() => setSpeakers((prev) => prev.filter((_, i) => i !== idx))} style={styles.removeSpeakerBtn} hitSlop={8}>
              <X size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ))}
        {speakers.length === 0 && <Text style={styles.speakerHint}>Tap Tag member or + Add row to add speakers.</Text>}
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
          <Text style={styles.dateRowText}>{format(startDate, 'MM/dd/yyyy · h:mm a')}</Text>
        </TouchableOpacity>
        <Text style={styles.label}>End date & time *</Text>
        <TouchableOpacity style={styles.dateRow} onPress={() => openPicker('end')} activeOpacity={0.7}>
          <Calendar size={20} color={colors.primary} />
          <Text style={styles.dateRowText}>{format(endDate, 'MM/dd/yyyy · h:mm a')}</Text>
        </TouchableOpacity>

        <Modal visible={showSpeakerPicker} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Tag speaker from members</Text>
              <Text style={styles.modalSub}>Select an event member. Their name, title, and company will be filled in from their profile.</Text>
              <ScrollView style={[styles.pickerScroll, { maxHeight: 280 }]} nestedScrollEnabled>
                {memberOptions.map((m) => (
                  <TouchableOpacity
                    key={m.user_id}
                    style={styles.memberRow}
                    onPress={() => {
                      setSpeakers((prev) => [...prev, { name: m.full_name, title: m.title ?? '', company: m.company ?? '' }]);
                      setShowSpeakerPicker(false);
                    }}
                  >
                    <Text style={styles.memberName}>{m.full_name}</Text>
                    {(m.title || m.company || m.role) && (
                      <Text style={styles.memberMeta}>{[m.title, m.company, m.role].filter(Boolean).join(' · ')}</Text>
                    )}
                  </TouchableOpacity>
                ))}
                {memberOptions.length === 0 && <Text style={styles.memberEmpty}>No members yet. Add members to the event first.</Text>}
              </ScrollView>
              <TouchableOpacity style={[styles.modalCancelBtn, { flex: undefined, alignSelf: 'stretch' }]} onPress={() => setShowSpeakerPicker(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
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
                        {format(d, 'MM/dd/yyyy')}
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
        <Text style={styles.label}>Day number (auto)</Text>
        <View style={[styles.input, styles.readOnlyField]}>
          <Text style={styles.readOnlyText}>{computedDayNumber}</Text>
        </View>
        <Text style={styles.label}>Session type (tap to select multiple)</Text>
        <View style={styles.typeRow}>
          {SESSION_TYPES.map((t) => {
            const isSelected = sessionTypes.includes(t);
            return (
              <TouchableOpacity
                key={t}
                style={[styles.typeChip, isSelected && styles.typeChipActive]}
                onPress={() => {
                  if (isSelected) {
                    const next = sessionTypes.filter((x) => x !== t);
                    setSessionTypes(next.length > 0 ? next : [t]);
                  } else {
                    setSessionTypes([...sessionTypes, t]);
                  }
                }}
              >
                <Text style={[styles.typeChipText, isSelected && styles.typeChipTextActive]}>{t}</Text>
              </TouchableOpacity>
            );
          })}
          {sessionTypes.filter((t) => !SESSION_TYPES.includes(t as typeof SESSION_TYPES[number])).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.typeChip, styles.typeChipActive]}
              onPress={() => {
                const next = sessionTypes.filter((x) => x !== t);
                setSessionTypes(next.length > 0 ? next : ['breakout']);
              }}
            >
              <Text style={[styles.typeChipText, styles.typeChipTextActive]}>{t} ✕</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.customTypeRow}>
          <TextInput
            style={[styles.input, styles.customTypeInput]}
            value={customTypeInput}
            onChangeText={setCustomTypeInput}
            placeholder="Create custom type (e.g. Panel, Fireside)"
            placeholderTextColor={colors.textMuted}
          />
          <TouchableOpacity
            style={[styles.addTypeBtn, (!customTypeInput.trim() || sessionTypes.includes(customTypeInput.trim().toLowerCase())) && styles.addTypeBtnDisabled]}
            onPress={() => {
              const v = customTypeInput.trim().toLowerCase().replace(/\s+/g, '_');
              if (v && !sessionTypes.includes(v)) {
                setSessionTypes((prev) => [...prev, v]);
                setCustomTypeInput('');
              }
            }}
            disabled={!customTypeInput.trim() || sessionTypes.includes(customTypeInput.trim().toLowerCase().replace(/\s+/g, '_'))}
          >
            <Text style={styles.addTypeBtnText}>Add</Text>
          </TouchableOpacity>
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 32 },
  csvRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  csvBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primary + '12',
  },
  csvBtnText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  csvBtnDisabled: { opacity: 0.7 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 14, color: colors.textSecondary },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6, marginTop: 12 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, marginTop: 12 },
  tagMemberBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.primary + '18', borderWidth: 1, borderColor: colors.primary },
  tagMemberText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  speakerAddRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  speakerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  speakerInfo: { flex: 1, flexDirection: 'column', gap: 0 },
  speakerInput: { marginBottom: 6 },
  removeSpeakerBtn: { padding: 8 },
  speakerHint: { fontSize: 13, color: colors.textMuted, marginBottom: 8 },
  customTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  customTypeInput: { flex: 1, marginBottom: 0 },
  addTypeBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primary },
  addTypeBtnDisabled: { opacity: 0.5 },
  addTypeBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  memberRow: { paddingVertical: 14, paddingHorizontal: 14, borderRadius: 8, marginBottom: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  memberName: { fontSize: 16, fontWeight: '600', color: colors.text },
  memberMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  memberEmpty: { fontSize: 14, color: colors.textMuted, padding: 16, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: 4,
  },
  readOnlyField: { justifyContent: 'center' },
  readOnlyText: { fontSize: 16, color: colors.text },
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
    marginBottom: 4,
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
