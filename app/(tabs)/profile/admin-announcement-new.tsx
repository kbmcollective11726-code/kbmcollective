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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { createNotification } from '../../../lib/notifications';
import { sendAnnouncementPush } from '../../../lib/pushNotifications';
import { colors } from '../../../constants/colors';
import DateTimePicker from '@react-native-community/datetimepicker';

type TargetType = 'all' | 'audience' | 'specific';
type AudienceRole = 'attendee' | 'speaker' | 'vendor';

type EventMemberOption = { user_id: string; full_name: string; role: string };

export default function AdminAnnouncementNewScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('all');
  const [audienceRoles, setAudienceRoles] = useState<AudienceRole[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [scheduleNow, setScheduleNow] = useState(true);
  const [scheduledDate, setScheduledDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [memberOptions, setMemberOptions] = useState<EventMemberOption[]>([]);

  useEffect(() => {
    if (!currentEvent?.id) return;
    (async () => {
      const { data } = await supabase
        .from('event_members')
        .select('user_id, role, users!inner(full_name)')
        .eq('event_id', currentEvent.id)
        .neq('role', 'super_admin');
      if (data) {
        setMemberOptions(
          (data as unknown as { user_id: string; role: string; users: { full_name: string } }[]).map((r) => ({
            user_id: r.user_id,
            full_name: (r.users && typeof r.users === 'object' && 'full_name' in r.users ? (r.users as { full_name: string }).full_name : null) ?? 'Unknown',
            role: r.role,
          }))
        );
      }
    })();
  }, [currentEvent?.id]);

  const toggleAudienceRole = (role: AudienceRole) => {
    setAudienceRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const getRecipientIds = async (): Promise<string[]> => {
    if (!currentEvent?.id) return [];
    if (targetType === 'all') {
      const { data } = await supabase
        .from('event_members')
        .select('user_id')
        .eq('event_id', currentEvent.id);
      return (data ?? []).map((r: { user_id: string }) => r.user_id);
    }
    if (targetType === 'audience' && audienceRoles.length > 0) {
      const { data } = await supabase
        .from('event_members')
        .select('user_id')
        .eq('event_id', currentEvent.id)
        .in('role', audienceRoles);
      return (data ?? []).map((r: { user_id: string }) => r.user_id);
    }
    if (targetType === 'specific' && selectedUserIds.length > 0) {
      return selectedUserIds;
    }
    return [];
  };

  const handleSend = async () => {
    if (!currentEvent?.id || !user?.id || !title.trim() || !content.trim()) {
      Alert.alert('Error', 'Title and content are required.');
      return;
    }
    if (targetType === 'audience' && audienceRoles.length === 0) {
      Alert.alert('Error', 'Select at least one audience type (attendee, speaker, vendor).');
      return;
    }
    if (targetType === 'specific' && selectedUserIds.length === 0) {
      Alert.alert('Error', 'Select at least one person.');
      return;
    }
    if (!scheduleNow && scheduledDate <= new Date()) {
      Alert.alert('Error', 'Scheduled time must be in the future.');
      return;
    }

    setSending(true);
    try {
      const scheduledAt = scheduleNow ? null : scheduledDate.toISOString();
      const { error } = await supabase.from('announcements').insert({
        event_id: currentEvent.id,
        title: title.trim(),
        content: content.trim(),
        priority: 'normal',
        send_push: scheduleNow,
        sent_by: user.id,
        target_type: targetType,
        target_audience: targetType === 'audience' ? audienceRoles : null,
        target_user_ids: targetType === 'specific' ? selectedUserIds : null,
        scheduled_at: scheduledAt,
      });
      if (error) throw error;

      if (scheduleNow) {
        const recipientIds = await getRecipientIds();
        for (const uid of recipientIds) {
          await createNotification(uid, currentEvent.id, 'announcement', title.trim(), content.trim(), {});
        }
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token && recipientIds.length > 0) {
          const { sent, error: pushErr } = await sendAnnouncementPush(
            session.access_token,
            currentEvent.id,
            title.trim(),
            content.trim(),
            recipientIds
          );
          if (pushErr) console.warn('Push send warning:', pushErr);
          Alert.alert('Sent', `Announcement sent to ${recipientIds.length} recipient(s).${sent > 0 ? ` Push notifications sent: ${sent}.` : ''}`);
        } else {
          Alert.alert('Sent', `Announcement sent to ${recipientIds.length} recipient(s).`);
        }
      } else {
        Alert.alert('Scheduled', `Announcement scheduled for ${scheduledDate.toLocaleString()}. Note: A backend job is required to send scheduled announcements.`);
      }
      router.back();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to send.');
    } finally {
      setSending(false);
    }
  };

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.placeholder}><Text style={styles.subtitle}>Select an event first.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Title</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Announcement title" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Message</Text>
        <TextInput style={[styles.input, styles.area]} value={content} onChangeText={setContent} placeholder="Message..." placeholderTextColor={colors.textMuted} multiline />

        <Text style={styles.label}>Send to</Text>
        <View style={styles.targetRow}>
          <TouchableOpacity
            style={[styles.targetChip, targetType === 'all' && styles.targetChipActive]}
            onPress={() => setTargetType('all')}
          >
            <Text style={[styles.targetChipText, targetType === 'all' && styles.targetChipTextActive]}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.targetChip, targetType === 'audience' && styles.targetChipActive]}
            onPress={() => setTargetType('audience')}
          >
            <Text style={[styles.targetChipText, targetType === 'audience' && styles.targetChipTextActive]}>By role</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.targetChip, targetType === 'specific' && styles.targetChipActive]}
            onPress={() => setTargetType('specific')}
          >
            <Text style={[styles.targetChipText, targetType === 'specific' && styles.targetChipTextActive]}>Specific</Text>
          </TouchableOpacity>
        </View>

        {targetType === 'audience' && (
          <View style={styles.audienceRow}>
            {(['attendee', 'speaker', 'vendor'] as AudienceRole[]).map((role) => (
              <TouchableOpacity
                key={role}
                style={[styles.roleChip, audienceRoles.includes(role) && styles.roleChipActive]}
                onPress={() => toggleAudienceRole(role)}
              >
                <Text style={[styles.roleChipText, audienceRoles.includes(role) && styles.roleChipTextActive]}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {targetType === 'specific' && (
          <View style={styles.userList}>
            {memberOptions.slice(0, 50).map((m) => (
              <TouchableOpacity
                key={m.user_id}
                style={[styles.userRow, selectedUserIds.includes(m.user_id) && styles.userRowSelected]}
                onPress={() => toggleUserSelection(m.user_id)}
              >
                <Text style={styles.userName}>{m.full_name}</Text>
                <Text style={styles.userRole}>{m.role}</Text>
              </TouchableOpacity>
            ))}
            {memberOptions.length > 50 && <Text style={styles.hint}>Showing first 50 members</Text>}
          </View>
        )}

        <Text style={styles.label}>Schedule</Text>
        <View style={styles.scheduleRow}>
          <TouchableOpacity
            style={[styles.scheduleChip, scheduleNow && styles.scheduleChipActive]}
            onPress={() => setScheduleNow(true)}
          >
            <Text style={[styles.scheduleChipText, scheduleNow && styles.scheduleChipTextActive]}>Send now</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scheduleChip, !scheduleNow && styles.scheduleChipActive]}
            onPress={() => setScheduleNow(false)}
          >
            <Text style={[styles.scheduleChipText, !scheduleNow && styles.scheduleChipTextActive]}>Schedule</Text>
          </TouchableOpacity>
        </View>
        {!scheduleNow && (
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
            <Text style={styles.dateBtnText}>
              {scheduledDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </Text>
          </TouchableOpacity>
        )}
        {showDatePicker && (
          <>
            {Platform.OS === 'ios' && (
              <View style={styles.datePickerActions}>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={styles.datePickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
            <DateTimePicker
              value={scheduledDate}
              mode="datetime"
              minimumDate={new Date()}
              onChange={(_, date) => {
                if (Platform.OS === 'android') setShowDatePicker(false);
                if (date) setScheduledDate(date);
              }}
            />
          </>
        )}

        <TouchableOpacity style={[styles.button, sending && styles.buttonDisabled]} onPress={handleSend} disabled={sending}>
          {sending ? <ActivityIndicator color={colors.textOnPrimary} size="small" /> : <Text style={styles.buttonText}>{scheduleNow ? 'Send announcement' : 'Schedule announcement'}</Text>}
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
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: colors.text, marginBottom: 8 },
  area: { minHeight: 120, textAlignVertical: 'top' },
  targetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  targetChip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  targetChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  targetChipText: { fontSize: 14, color: colors.text },
  targetChipTextActive: { color: '#fff', fontWeight: '600' },
  audienceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  roleChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  roleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleChipText: { fontSize: 13, color: colors.text },
  roleChipTextActive: { color: '#fff', fontWeight: '600' },
  userList: { maxHeight: 180, marginBottom: 12 },
  userRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginBottom: 4, borderWidth: 1, borderColor: colors.border },
  userRowSelected: { backgroundColor: colors.primaryFaded, borderColor: colors.primary },
  userName: { fontSize: 14, color: colors.text },
  userRole: { fontSize: 12, color: colors.textSecondary },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  scheduleRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  scheduleChip: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  scheduleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  scheduleChipText: { fontSize: 14, color: colors.text },
  scheduleChipTextActive: { color: '#fff', fontWeight: '600' },
  dateBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  dateBtnText: { fontSize: 16, color: colors.text },
  datePickerActions: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 8 },
  datePickerDone: { fontSize: 16, fontWeight: '600', color: colors.primary },
  button: { backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { fontSize: 16, fontWeight: '600', color: colors.textOnPrimary },
});
