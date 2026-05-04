import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  BackHandler,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { Share2 } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import ProfileStackScreenHeader from '../../../components/ProfileStackScreenHeader';
import { colors } from '../../../constants/colors';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase, withRetryAndRefresh } from '../../../lib/supabase';
import {
  listVendorMeetingAttendanceForEvent,
  vendorScanRowShowsAttended,
  type VendorMeetingAttendanceRow,
} from '../../../lib/badgeRpc';

type AdminScanRow = {
  id?: string;
  scanner_kind: string;
  attended_meeting: boolean;
  note: string | null;
  updated_at: string;
  created_at?: string;
  meeting: { id: string; label: string } | null;
  scanner: { user_id?: string; full_name: string; email: string };
  subject: { user_id?: string; full_name: string; email: string; company: string };
};

type VendorScanRow = {
  id: string;
  subject_user_id: string;
  subject_name: string;
  subject_company: string;
  attended_meeting: boolean;
  note: string;
  meeting_booking_id: string | null;
  meeting_label: string | null;
  updated_at: string;
};

function formatWhen(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    const d = parseISO(String(iso).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return '—';
    return format(d, 'MMM d, h:mm a');
  } catch {
    return '—';
  }
}

function buildExportPlainText(
  eventName: string,
  mode: 'admin' | 'vendor',
  adminRows: AdminScanRow[],
  vendorRows: VendorScanRow[],
  vendorMeetingBySubject: Record<string, VendorMeetingAttendanceRow[]>
): string {
  const lines: string[] = [];
  lines.push('KBM Connect — Badge notes export');
  lines.push(`Event: ${eventName}`);
  lines.push(`Exported: ${new Date().toLocaleString()}`);
  lines.push(mode === 'admin' ? 'View: Event admin (all scanners)' : 'View: Vendor (your scans)');
  lines.push('');
  lines.push('='.repeat(48));
  lines.push('');

  if (mode === 'admin') {
    adminRows.forEach((r, i) => {
      if (i > 0) {
        lines.push('—'.repeat(40));
        lines.push('');
      }
      lines.push(`Subject: ${r.subject?.full_name ?? '—'}`);
      lines.push(`Subject email: ${r.subject?.email ?? '—'}`);
      if (r.subject?.company) lines.push(`Company: ${r.subject.company}`);
      lines.push(`Scanner: ${r.scanner?.full_name ?? '—'}`);
      lines.push(`Scanner email: ${r.scanner?.email ?? '—'}`);
      lines.push(`Scanner kind: ${r.scanner_kind || '—'}`);
      if (r.meeting?.label) lines.push(`Meeting: ${r.meeting.label}`);
      lines.push(`Attendance: ${r.attended_meeting ? 'Yes' : 'No'} · Updated ${formatWhen(r.updated_at || r.created_at)}`);
      lines.push(`Note: ${r.note?.trim() ? r.note.trim() : 'No note'}`);
      lines.push('');
    });
  } else {
    vendorRows.forEach((r, i) => {
      const sid = String(r.subject_user_id || '').toLowerCase();
      const perMeeting = vendorMeetingBySubject[sid] ?? [];
      const attendedAny = vendorScanRowShowsAttended(r, perMeeting);
      if (i > 0) {
        lines.push('—'.repeat(40));
        lines.push('');
      }
      lines.push(`Subject: ${r.subject_name || '—'}`);
      if (r.subject_company) lines.push(`Company: ${r.subject_company}`);
      if (r.meeting_label && !perMeeting.length) lines.push(`Meeting: ${r.meeting_label}`);
      lines.push(`Attendance (overall): ${attendedAny ? 'Yes' : 'No'} · Updated ${formatWhen(r.updated_at)}`);
      if (perMeeting.length > 0) {
        lines.push('By meeting:');
        for (const m of perMeeting) {
          lines.push(`  - ${(m.meeting_label || 'Meeting').trim()}: ${m.attended_meeting ? 'Yes' : 'No'}`);
        }
      }
      lines.push(`Note: ${r.note?.trim() ? r.note.trim() : 'No note'}`);
      lines.push('');
    });
  }

  return lines.join('\n');
}

export default function BadgeNotesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const { user } = useAuthStore();
  const { currentEvent, adminCheckTick } = useEventStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'admin' | 'vendor' | null>(null);
  const [adminRows, setAdminRows] = useState<AdminScanRow[]>([]);
  const [vendorRows, setVendorRows] = useState<VendorScanRow[]>([]);
  const [vendorMeetingBySubject, setVendorMeetingBySubject] = useState<Record<string, VendorMeetingAttendanceRow[]>>(
    {}
  );
  const [exportBusy, setExportBusy] = useState(false);

  const isPlatformAdmin = user?.is_platform_admin === true;

  const exitHref = useMemo(() => {
    const raw = params.from;
    const f = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    if (!f) return '/(tabs)/profile';
    try {
      const d = decodeURIComponent(f).trim();
      return d.startsWith('/') ? d : '/(tabs)/profile';
    } catch {
      return '/(tabs)/profile';
    }
  }, [params.from]);

  const hasExplicitReturnHref = useMemo(() => {
    const raw = params.from;
    const f = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    return f.trim().length > 0;
  }, [params.from]);

  const handleBack = useCallback(() => {
    if (hasExplicitReturnHref) {
      router.replace(exitHref as any);
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(exitHref as any);
    }
  }, [router, exitHref, hasExplicitReturnHref]);

  const resolveCanAdmin = useCallback(async (): Promise<boolean> => {
    if (!user?.id || !currentEvent?.id) return false;
    if (isPlatformAdmin) return true;
    try {
      const data = await withRetryAndRefresh(async () => {
        const { data: d, error } = await supabase
          .from('event_members')
          .select('role, roles')
          .eq('event_id', currentEvent.id)
          .eq('user_id', user.id)
          .single();
        if (error) throw error;
        return d;
      });
      const row = data as { role?: string; roles?: string[] } | null;
      const role = row?.role ?? 'attendee';
      const roles = Array.isArray(row?.roles) ? row.roles : [];
      return (
        role === 'admin' || role === 'super_admin' || roles.includes('admin') || roles.includes('super_admin')
      );
    } catch {
      return false;
    }
  }, [user?.id, currentEvent?.id, isPlatformAdmin]);

  const load = useCallback(async () => {
    if (!currentEvent?.id || !user?.id) {
      setMode(null);
      setAdminRows([]);
      setVendorRows([]);
      setVendorMeetingBySubject({});
      setError(null);
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const canAdmin = await resolveCanAdmin();
      if (canAdmin) {
        const { data, error: rpcErr } = await supabase.rpc('list_event_badge_scans', {
          p_event_id: currentEvent.id,
        });
        if (rpcErr) throw rpcErr;
        const raw = typeof data === 'string' ? (JSON.parse(data) as unknown) : data;
        const pack = raw as { rows?: AdminScanRow[]; error?: string } | null;
        if (pack?.error) throw new Error(pack.error);
        setMode('admin');
        setAdminRows(Array.isArray(pack?.rows) ? pack!.rows! : []);
        setVendorRows([]);
        setVendorMeetingBySubject({});
        return;
      }

      const [{ data: scanData, error: vErr }, meetRes] = await Promise.all([
        supabase.rpc('list_vendor_badge_scans_for_event', {
          p_event_id: currentEvent.id,
          p_subject_ids: null,
        }),
        listVendorMeetingAttendanceForEvent(currentEvent.id),
      ]);
      if (vErr) throw vErr;
      const rawV = typeof scanData === 'string' ? (JSON.parse(scanData) as unknown) : scanData;
      const pack = rawV as { rows?: VendorScanRow[]; error?: string } | null;
      if (pack?.error) throw new Error(pack.error);
      const scans = Array.isArray(pack?.rows) ? pack!.rows! : [];
      const bySub: Record<string, VendorMeetingAttendanceRow[]> = {};
      if (!meetRes.error && meetRes.rows) {
        for (const row of meetRes.rows) {
          const sid = String(row.subject_user_id || '').toLowerCase();
          if (!sid) continue;
          if (!bySub[sid]) bySub[sid] = [];
          bySub[sid].push(row);
        }
      }
      setMode('vendor');
      setVendorRows(scans);
      setVendorMeetingBySubject(bySub);
      setAdminRows([]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Could not load notes.');
      setMode(null);
      setAdminRows([]);
      setVendorRows([]);
      setVendorMeetingBySubject({});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentEvent?.id, user?.id, resolveCanAdmin]);

  useEffect(() => {
    load();
  }, [load, adminCheckTick]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBack();
        return true;
      });
      return () => sub.remove();
    }, [handleBack])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const emptyHint = useMemo(() => {
    if (mode === 'admin') return 'No badge scans recorded for this event yet.';
    if (mode === 'vendor') return 'You have not saved any scans with notes or attendance yet.';
    return 'Select an event and open Notes from the menu again.';
  }, [mode]);

  const exportDisabled =
    !!error ||
    !mode ||
    (mode === 'admin' && adminRows.length === 0) ||
    (mode === 'vendor' && vendorRows.length === 0);

  const handleExportNotes = useCallback(async () => {
    if (!currentEvent?.id || !mode || exportDisabled) {
      if (exportDisabled && currentEvent?.id) {
        Alert.alert('Nothing to export', emptyHint);
      }
      return;
    }
    setExportBusy(true);
    try {
      const body = buildExportPlainText(
        currentEvent.name?.trim() || 'Event',
        mode,
        adminRows,
        vendorRows,
        vendorMeetingBySubject
      );
      const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
      const baseDir = dir && !dir.endsWith('/') ? `${dir}/` : dir;
      const slug = (currentEvent.name || 'event')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'event';
      const path = `${baseDir}badge-notes-${slug}-${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(path, body, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Export ready', 'Sharing is not available on this device. Try again on a phone or tablet.');
        return;
      }
      await Sharing.shareAsync(path, {
        mimeType: 'text/plain',
        dialogTitle: 'Export notes',
        UTI: 'public.plain-text',
      });
      Toast.show({
        type: 'success',
        text1: 'Share sheet opened',
        text2: Platform.OS === 'ios' ? 'Choose Mail, Save to Files, or another app.' : 'Choose an app to send or save the file.',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Export failed';
      Alert.alert('Export failed', msg);
    } finally {
      setExportBusy(false);
    }
  }, [
    currentEvent?.id,
    currentEvent?.name,
    mode,
    adminRows,
    vendorRows,
    vendorMeetingBySubject,
    exportDisabled,
    emptyHint,
  ]);

  const headerRight = useMemo(
    () => (
      <TouchableOpacity
        onPress={() => {
          void handleExportNotes();
        }}
        disabled={exportDisabled || exportBusy || loading}
        style={styles.headerShareTap}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Export notes"
      >
        {exportBusy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Share2 size={22} color={colors.primary} style={{ opacity: exportDisabled || loading ? 0.35 : 1 }} />
        )}
      </TouchableOpacity>
    ),
    [exportDisabled, exportBusy, loading, handleExportNotes]
  );

  if (!currentEvent?.id) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Notes" onBack={handleBack} />
        <View style={styles.centered}>
          <Text style={styles.muted}>Select an event to see badge scan notes and attendance.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader variant="back" title="Notes" onBack={handleBack} right={headerRight} />
      {loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.lead}>
            Badge scans: attendance and notes{mode === 'admin' ? ' (all scanners)' : ' (your scans as a vendor rep)'}.
            {'\n'}
            <Text style={styles.leadExportHint}>Tap the share icon above to export as a .txt file (Mail, Files, Drive, etc.).</Text>
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {mode === 'admin' && adminRows.length === 0 && !error ? (
            <Text style={styles.muted}>{emptyHint}</Text>
          ) : null}
          {mode === 'vendor' && vendorRows.length === 0 && !error ? (
            <Text style={styles.muted}>{emptyHint}</Text>
          ) : null}

          {mode === 'admin'
            ? adminRows.map((r, i) => (
                <View key={r.id ?? `${r.subject?.user_id ?? ''}-${r.updated_at}-${i}`} style={styles.card}>
                  <Text style={styles.name}>{r.subject?.full_name ?? '—'}</Text>
                  {r.subject?.company ? <Text style={styles.sub}>{r.subject.company}</Text> : null}
                  <Text style={styles.meta}>
                    Scanner: {r.scanner?.full_name ?? '—'} · {r.scanner_kind || '—'}
                  </Text>
                  {r.meeting?.label ? <Text style={styles.meta}>Meeting: {r.meeting.label}</Text> : null}
                  <Text style={styles.meta}>
                    Attendance: {r.attended_meeting ? 'Yes' : 'No'} · {formatWhen(r.updated_at || r.created_at)}
                  </Text>
                  {r.note?.trim() ? <Text style={styles.note}>{r.note.trim()}</Text> : <Text style={styles.mutedSmall}>No note</Text>}
                </View>
              ))
            : null}

          {mode === 'vendor'
            ? vendorRows.map((r) => {
                const sid = String(r.subject_user_id || '').toLowerCase();
                const perMeeting = vendorMeetingBySubject[sid] ?? [];
                const attendedAny = vendorScanRowShowsAttended(r, perMeeting);
                return (
                  <View key={r.id} style={styles.card}>
                    <Text style={styles.name}>{r.subject_name || '—'}</Text>
                    {r.subject_company ? <Text style={styles.sub}>{r.subject_company}</Text> : null}
                    {r.meeting_label && !perMeeting.length ? (
                      <Text style={styles.meta}>Meeting: {r.meeting_label}</Text>
                    ) : null}
                    <Text style={styles.meta}>
                      Attendance: {attendedAny ? 'Yes' : 'No'} · {formatWhen(r.updated_at)}
                    </Text>
                    {perMeeting.length > 0 ? (
                      <View style={styles.perMeetingBlock}>
                        <Text style={styles.perMeetingHeading}>By meeting</Text>
                        {perMeeting.map((m) => (
                          <Text key={m.id} style={styles.perMeetingLine}>
                            {(m.meeting_label || 'Meeting').trim()}: {m.attended_meeting ? 'Yes' : 'No'}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {r.note?.trim() ? <Text style={styles.note}>{r.note.trim()}</Text> : <Text style={styles.mutedSmall}>No note</Text>}
                  </View>
                );
              })
            : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerShareTap: { paddingVertical: 8, paddingHorizontal: 10, marginRight: 4 },
  lead: { fontSize: 14, color: colors.textSecondary, marginBottom: 16, lineHeight: 20 },
  leadExportHint: { fontSize: 13, color: colors.textMuted, marginTop: 6 },
  error: { color: colors.danger, marginBottom: 12, fontSize: 14 },
  muted: { fontSize: 14, color: colors.textMuted },
  mutedSmall: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  sub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  note: { fontSize: 14, color: colors.text, marginTop: 10, lineHeight: 20 },
  perMeetingBlock: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  perMeetingHeading: { fontSize: 11, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 4 },
  perMeetingLine: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
