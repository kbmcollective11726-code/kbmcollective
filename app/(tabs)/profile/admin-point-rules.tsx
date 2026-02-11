import { useState, useEffect, useCallback } from 'react';
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
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { initializePointRules } from '../../../lib/points';
import { colors } from '../../../constants/colors';
import { Trash2 } from 'lucide-react-native';

const ALL_ACTIONS = [
  'post_photo',
  'give_like',
  'comment',
  'receive_like',
  'receive_comment',
  'connect',
  'attend_session',
  'complete_profile',
  'daily_streak',
  'vendor_meeting',
  'checkin',
  'share_linkedin',
] as const;

const ACTION_LABELS: Record<string, string> = {
  post_photo: 'Post a photo',
  give_like: "Like someone else's post",
  comment: "Comment on someone else's post",
  receive_like: 'Someone liked your post',
  receive_comment: 'Someone commented on your post',
  connect: 'Connect with another attendee',
  attend_session: 'Attend a session',
  complete_profile: 'Complete your profile',
  daily_streak: 'Daily streak',
  vendor_meeting: 'Visit a vendor booth',
  checkin: 'Check in at event',
  share_linkedin: 'Share on LinkedIn',
};

type PointRuleRow = { id: string; action: string; points_value: number; max_per_day: number | null; description: string | null };

type MaxLimitMode = 'none' | 'limit';

function getMaxLimitMode(maxPerDay: string): MaxLimitMode {
  return maxPerDay.trim() === '' ? 'none' : 'limit';
}

export default function AdminPointRulesScreen() {
  const { currentEvent } = useEventStore();
  const [rules, setRules] = useState<PointRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, { points: string; maxPerDay: string; maxLimitMode: MaxLimitMode; description: string }>>({});

  const loadRules = useCallback(async () => {
    if (!currentEvent?.id) return;
    const { data, error } = await supabase
      .from('point_rules')
      .select('id, action, points_value, max_per_day, description')
      .eq('event_id', currentEvent.id)
      .order('action');
    if (error) {
      setRules([]);
      setValues({});
    } else {
      const rows = (data ?? []) as PointRuleRow[];
      const byAction = new Map<string, PointRuleRow>();
      rows.forEach((r) => { if (!byAction.has(r.action)) byAction.set(r.action, r); });
      setRules(Array.from(byAction.values()).sort((a, b) => a.action.localeCompare(b.action)));
      const v: Record<string, { points: string; maxPerDay: string; maxLimitMode: MaxLimitMode; description: string }> = {};
      Array.from(byAction.values()).forEach((r: PointRuleRow) => {
        const maxPerDay = r.max_per_day != null ? String(r.max_per_day) : '';
        v[r.action] = {
          points: String(r.points_value),
          maxPerDay,
          maxLimitMode: getMaxLimitMode(maxPerDay),
          description: r.description?.trim() ?? '',
        };
      });
      setValues(v);
    }
  }, [currentEvent?.id]);

  useEffect(() => {
    if (!currentEvent?.id) return;
    let cancelled = false;
    (async () => {
      await loadRules();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [currentEvent?.id, loadRules]);

  const handleSaveOne = async (action: string) => {
    if (!currentEvent?.id) return;
    const v = values[action];
    if (!v) return;
    const points = parseInt(v.points, 10);
    if (isNaN(points) || points < 0) {
      Alert.alert('Error', 'Points must be 0 or greater.');
      return;
    }
    const maxPerDay = v.maxLimitMode === 'none' || v.maxPerDay.trim() === '' ? null : parseInt(v.maxPerDay, 10);
    if (v.maxLimitMode === 'limit' && (isNaN(maxPerDay!) || maxPerDay! < 0)) {
      Alert.alert('Error', 'Max per day must be empty or 0 or greater.');
      return;
    }
    const description = v.description?.trim() || null;
    setSaving(true);
    try {
      const existing = rules.find((r) => r.action === action);
      if (existing) {
        const { error } = await supabase
          .from('point_rules')
          .update({ points_value: points, max_per_day: maxPerDay, description })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('point_rules').insert({
          event_id: currentEvent.id,
          action,
          points_value: points,
          max_per_day: maxPerDay,
          description: description ?? ACTION_LABELS[action] ?? action.replace(/_/g, ' '),
        });
        if (error) throw error;
      }
      Alert.alert('Saved', 'Point rule updated. The "How to earn points" popup will show this.');
      const { data } = await supabase.from('point_rules').select('id, action, points_value, max_per_day, description').eq('event_id', currentEvent.id).order('action');
      const rows = (data ?? []) as PointRuleRow[];
      const byAction = new Map<string, PointRuleRow>();
      rows.forEach((r) => { if (!byAction.has(r.action)) byAction.set(r.action, r); });
      setRules(Array.from(byAction.values()).sort((a, b) => a.action.localeCompare(b.action)));
      const newV: Record<string, { points: string; maxPerDay: string; maxLimitMode: MaxLimitMode; description: string }> = {};
      Array.from(byAction.values()).forEach((r: PointRuleRow) => {
        const maxPerDayStr = r.max_per_day != null ? String(r.max_per_day) : '';
        newV[r.action] = {
          points: String(r.points_value),
          maxPerDay: maxPerDayStr,
          maxLimitMode: getMaxLimitMode(maxPerDayStr),
          description: r.description?.trim() ?? '',
        };
      });
      setValues(newV);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const setValue = (action: string, field: 'points' | 'maxPerDay' | 'description', text: string) => {
    setValues((prev) => ({
      ...prev,
      [action]: { ...(prev[action] ?? { points: '', maxPerDay: '', maxLimitMode: 'none', description: '' }), [field]: text },
    }));
  };

  const setMaxLimitMode = (action: string, mode: MaxLimitMode) => {
    setValues((prev) => ({
      ...prev,
      [action]: {
        ...(prev[action] ?? { points: '', maxPerDay: '', maxLimitMode: 'none', description: '' }),
        maxLimitMode: mode,
        maxPerDay: mode === 'none' ? '' : (prev[action]?.maxPerDay ?? ''),
      },
    }));
  };

  const handleAddDefaults = async () => {
    if (!currentEvent?.id) return;
    setSaving(true);
    try {
      await initializePointRules(currentEvent.id);
      Alert.alert('Done', 'Default point rules (5) added. You can edit, add more, or delete.');
      await loadRules();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to add defaults.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = async () => {
    if (!currentEvent?.id) return;
    Alert.alert(
      'Reset to default rules',
      'This will remove all current rules and add only the 5 defaults: Post a photo, Like someone\'s post, Comment, Someone liked your post, Someone commented on your post. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await supabase.from('point_rules').delete().eq('event_id', currentEvent.id);
              await initializePointRules(currentEvent.id);
              Alert.alert('Done', 'Reset to 5 default point rules.');
              await loadRules();
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to reset.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const handleDelete = async (ruleId: string, action: string) => {
    Alert.alert(
      'Delete rule',
      `Remove "${ACTION_LABELS[action] ?? action}" from point rules?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const { error } = await supabase.from('point_rules').delete().eq('id', ruleId);
              if (error) throw error;
              Alert.alert('Deleted', 'Rule removed. The "How to earn points" popup will no longer show it.');
              await loadRules();
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const handleAddRule = async (action: string) => {
    if (!currentEvent?.id) return;
    if (rules.some((r) => r.action === action)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('point_rules').insert({
        event_id: currentEvent.id,
        action,
        points_value: 10,
        max_per_day: null,
        description: ACTION_LABELS[action] ?? action.replace(/_/g, ' '),
      });
      if (error) throw error;
      Alert.alert('Added', 'Rule added. Edit points and label below, then Save.');
      await loadRules();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to add rule.');
    } finally {
      setSaving(false);
    }
  };

  const availableToAdd = ALL_ACTIONS.filter((a) => !rules.some((r) => r.action === a));

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
          <Text style={styles.subtitle}>Loading point rules…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          <Text style={styles.title}>Point rules</Text>
          <Text style={styles.hint} numberOfLines={4}>
            Add, edit, or delete rules. Default: Post a photo, Like someone's post, Comment, Someone liked your post, Someone commented on your post.
          </Text>
          {rules.length === 0 ? (
            <TouchableOpacity style={styles.addDefaultsBtn} onPress={handleAddDefaults} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.addDefaultsText}>Add default point rules (5)</Text>}
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity style={styles.resetBtn} onPress={handleResetToDefaults} disabled={saving}>
                <Text style={styles.resetBtnText}>Reset to default rules (5)</Text>
              </TouchableOpacity>
              {availableToAdd.length > 0 ? (
                <View style={styles.addSection}>
                  <Text style={styles.addSectionTitle}>Add rule</Text>
                  <View style={styles.addRuleRow}>
                    {availableToAdd.map((action) => (
                      <TouchableOpacity
                        key={action}
                        style={styles.addRuleChip}
                        onPress={() => handleAddRule(action)}
                        disabled={saving}
                      >
                        <Text style={styles.addRuleChipText} numberOfLines={2}>
                          + {ACTION_LABELS[action] ?? action.replace(/_/g, ' ')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          )}
          {rules.map((rule) => {
            const action = rule.action;
            const displayLabel = ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
            return (
              <View key={rule.id} style={styles.card}>
                <Text style={styles.fieldLabel}>Label (for "How to earn points" popup)</Text>
                <TextInput
                  style={[styles.input, styles.descriptionInput]}
                  value={values[action]?.description ?? ''}
                  onChangeText={(t) => setValue(action, 'description', t)}
                  placeholder={displayLabel}
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
                <View style={styles.row}>
                  <View style={styles.fieldPoints}>
                    <Text style={styles.fieldLabel}>Points</Text>
                    <TextInput
                      style={styles.input}
                      value={values[action]?.points ?? ''}
                      onChangeText={(t) => setValue(action, 'points', t)}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                    />
                  </View>
                  <View style={styles.fieldMax}>
                    <Text style={styles.fieldLabel}>Max per day</Text>
                    <View style={styles.maxLimitRow}>
                      <TouchableOpacity
                        style={[styles.maxLimitToggle, (values[action]?.maxLimitMode ?? 'none') === 'none' && styles.maxLimitToggleActive]}
                        onPress={() => setMaxLimitMode(action, 'none')}
                      >
                        <Text style={[(values[action]?.maxLimitMode ?? 'none') === 'none' ? styles.maxLimitTextActive : styles.maxLimitText]} numberOfLines={1}>No limit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.maxLimitToggle, values[action]?.maxLimitMode === 'limit' && styles.maxLimitToggleActive]}
                        onPress={() => setMaxLimitMode(action, 'limit')}
                      >
                        <Text style={values[action]?.maxLimitMode === 'limit' ? styles.maxLimitTextActive : styles.maxLimitText} numberOfLines={1}>Limit:</Text>
                      </TouchableOpacity>
                      <TextInput
                        style={[styles.input, styles.maxLimitInput, values[action]?.maxLimitMode !== 'limit' && styles.inputDisabled]}
                        value={values[action]?.maxPerDay ?? ''}
                        onChangeText={(t) => setValue(action, 'maxPerDay', t)}
                        placeholder="10"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        editable={values[action]?.maxLimitMode === 'limit'}
                      />
                    </View>
                  </View>
                </View>
                <View style={styles.cardActions}>
                  <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={() => handleSaveOne(action)} disabled={saving}>
                    <Text style={styles.saveBtnText}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDelete(rule.id, action)}
                    disabled={saving}
                  >
                    <Trash2 size={18} color={colors.danger} />
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  scrollView: { flex: 1 },
  content: { padding: 16, paddingBottom: 100, maxWidth: '100%' },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 12 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 8 },
  hint: { fontSize: 13, color: colors.textSecondary, marginBottom: 16 },
  addDefaultsBtn: { backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 24 },
  addDefaultsText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  resetBtn: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 16, marginBottom: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  resetBtnText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  addSection: { marginBottom: 16 },
  addSectionTitle: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  addRuleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addRuleChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary, maxWidth: '100%' },
  addRuleChipText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border, width: '100%' },
  cardLabel: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4 },
  cardHint: { fontSize: 12, color: colors.textMuted, marginBottom: 12 },
  descriptionInput: { marginBottom: 12, minHeight: 40 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  field: { flex: 1, minWidth: 0 },
  fieldPoints: { width: 72, minWidth: 72 },
  fieldMax: { flex: 1, minWidth: 0 },
  fieldLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.text },
  inputDisabled: { backgroundColor: colors.surface, color: colors.textMuted },
  maxLimitRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  maxLimitToggle: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  maxLimitToggleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  maxLimitText: { fontSize: 13, color: colors.textSecondary },
  maxLimitTextActive: { fontSize: 13, fontWeight: '600', color: '#fff' },
  maxLimitInput: { width: 48, minWidth: 48 },
  cardActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  saveBtn: { paddingVertical: 8, paddingHorizontal: 16, backgroundColor: colors.primary, borderRadius: 8 },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 12 },
  deleteBtnText: { fontSize: 14, color: colors.danger, fontWeight: '600' },
});
