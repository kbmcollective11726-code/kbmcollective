import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  Linking,
  Pressable,
  ScrollView,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MessageCircle, UserPlus } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import ProfileStackScreenHeader from '../../../components/ProfileStackScreenHeader';
import { colors } from '../../../constants/colors';
import { useAuthStore } from '../../../stores/authStore';
import { useBlockStore } from '../../../stores/blockStore';
import { supabase } from '../../../lib/supabase';
import { createNotificationAndPush } from '../../../lib/notifications';
import {
  parseBadgeTokenFromQrData,
  resolveBadgeToken,
  upsertBadgeScan,
  fetchMyBadgeScanForSubject,
  listBadgeMeetingOptions,
  listAttendeeMeetingsWithScannedVendor,
  listVendorMeetingAttendanceForSubject,
  normalizeMeetingBookingId,
  formatBadgeMeetingOptionLabel,
  type ResolvedBadge,
  type BadgeMeetingOption,
  type VendorMeetingAttendanceRow,
} from '../../../lib/badgeRpc';
function isVendorLike(kind: string | undefined): boolean {
  return kind === 'vendor';
}

/** Non-vendor (attendee, speaker, admin, …) scanning another non-vendor badge: Connect only, no lead / 1:1 log. */
function isNonVendorPeerBadgeScan(resolved: ResolvedBadge, scannerKind: string | undefined): boolean {
  if (isVendorLike(scannerKind ?? '')) return false;
  return !isVendorLike(resolved.subject_kind ?? '');
}

/** Attendee or speaker scanning a vendor badge: show their own 1:1s with that vendor’s booth(s) (read-only). */
function isAttendeeScanningVendor(resolved: ResolvedBadge, scannerKind: string | undefined): boolean {
  return (scannerKind === 'attendee' || scannerKind === 'speaker') && resolved.subject_kind === 'vendor';
}

/** Vendor scanning another vendor — no unscheduled / general visit (product rule). */
function isVendorScanningVendor(resolved: ResolvedBadge, scannerKind: string | undefined): boolean {
  return isVendorLike(scannerKind ?? '') && isVendorLike(resolved.subject_kind ?? '');
}

/** Event admin scanning any badge: Connect + profile + notes only (no 1:1 / booth UI). */
function isAdminScanner(kind: string | undefined): boolean {
  return kind === 'admin' || kind === 'super_admin';
}

export default function BadgeScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ t?: string; from?: string }>();

  /** Token present in the URL (deep link); omit when user scanned inside this session only. */
  const urlToken = useMemo(() => {
    const raw = params.t;
    const t = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    return t && t.length > 0 ? t : undefined;
  }, [params.t]);

  /** Route to return to when `from` is set (menu / expo); else fallback for cold links. */
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
  const { user: currentUser } = useAuthStore();
  const { fetchBlockedUsers, isInteractionBlocked } = useBlockStore();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<'camera' | 'detail'>(() => (params.t ? 'detail' : 'camera'));
  const [token, setToken] = useState<string | null>(params.t ?? null);
  const [resolved, setResolved] = useState<ResolvedBadge | null>(null);
  const [scannerKind, setScannerKind] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [attended, setAttended] = useState(false);
  const [meetingOptions, setMeetingOptions] = useState<BadgeMeetingOption[]>([]);
  const [attendeeVendorMeetings, setAttendeeVendorMeetings] = useState<BadgeMeetingOption[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [meetingAttendanceById, setMeetingAttendanceById] = useState<Record<string, boolean>>({});
  const [scanCooldown, setScanCooldown] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [requestSentByMe, setRequestSentByMe] = useState(false);
  const [requestReceivedFromThem, setRequestReceivedFromThem] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const loadDetail = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    setMeetingOptions([]);
    setAttendeeVendorMeetings([]);
    setSelectedMeetingId(null);
    setMeetingAttendanceById({});
    setAttended(false);
    setNote('');
    const { data, error: err } = await resolveBadgeToken(tok);
    if (err || !data) {
      setLoading(false);
      setError(err || 'Could not load badge.');
      setResolved(null);
      return;
    }
    setResolved(data);
    setScannerKind(data.scanner_kind);
    setPhase('detail');
    const adminScan = isAdminScanner(data.scanner_kind);
    const peerScan = isNonVendorPeerBadgeScan(data, data.scanner_kind);
    const attendeeVendorScan = isAttendeeScanningVendor(data, data.scanner_kind);
    if (adminScan) {
      const prev = await fetchMyBadgeScanForSubject(data.event_id, data.subject.user_id);
      if (prev) setNote(prev.note ?? '');
      setLoading(false);
      return;
    }
    if (!peerScan && attendeeVendorScan) {
      const av = await listAttendeeMeetingsWithScannedVendor(tok);
      if (av.error) {
        if (__DEV__) console.warn('listAttendeeMeetingsWithScannedVendor', av.error);
        setAttendeeVendorMeetings([]);
        Toast.show({ type: 'error', text1: 'Could not load meetings', text2: av.error });
      } else {
        setAttendeeVendorMeetings(av.rows ?? []);
      }
    } else if (!peerScan) {
      const opt = await listBadgeMeetingOptions(tok);
      if (opt.error) {
        if (__DEV__) console.warn('listBadgeMeetingOptions', opt.error);
        setMeetingOptions([]);
        if (data.scanner_kind === 'vendor') {
          Toast.show({ type: 'error', text1: 'Could not load meetings', text2: opt.error });
        }
      } else if (opt.rows && opt.rows.length > 0) {
        const normalizedRows = opt.rows
          .map((row) => {
            const id = normalizeMeetingBookingId(row.id);
            return id ? { ...row, id } : null;
          })
          .filter((row): row is BadgeMeetingOption => !!row);
        setMeetingOptions(normalizedRows);
        if (data.scanner_kind === 'vendor') {
          const existing = await listVendorMeetingAttendanceForSubject(data.event_id, data.subject.user_id);
          if (existing.rows) {
            const map: Record<string, boolean> = {};
            for (const row of existing.rows as VendorMeetingAttendanceRow[]) {
              const id = normalizeMeetingBookingId(row.meeting_booking_id);
              if (id) map[id] = row.attended_meeting === true;
            }
            setMeetingAttendanceById(map);
          }
        }
      }
    }
    /** Restore saved note + general visit toggle (same `badge_scans` row `upsert_badge_scan` writes). */
    if (!peerScan && !attendeeVendorScan) {
      const prev = await fetchMyBadgeScanForSubject(data.event_id, data.subject.user_id);
      if (prev) {
        const v2v = isVendorScanningVendor(data, data.scanner_kind);
        setAttended(v2v ? false : prev.attended_meeting);
        setNote(prev.note);
      }
    }
    setLoading(false);
  }, []);

  const onAttendedChange = useCallback((next: boolean) => {
    setAttended(next);
  }, []);

  const setMeetingAttended = useCallback((meetingId: string, next: boolean) => {
    setMeetingAttendanceById((prev) => ({ ...prev, [meetingId]: next }));
  }, []);

  const adminSimpleBadge = !!resolved && isAdminScanner(scannerKind);
  const peer = !!resolved && isNonVendorPeerBadgeScan(resolved, scannerKind) && !adminSimpleBadge;
  const attendeeScansVendor = !!resolved && isAttendeeScanningVendor(resolved, scannerKind);

  useEffect(() => {
    const uid = resolved?.subject.user_id;
    /** Badge QR is always for the token's event — not necessarily the tab's `currentEvent`. */
    const badgeEventId = resolved?.event_id;
    if (!uid || !currentUser?.id || !badgeEventId) {
      setIsConnected(false);
      setRequestSentByMe(false);
      setRequestReceivedFromThem(false);
      return;
    }
    const shouldLoadConnectionState =
      isAdminScanner(scannerKind) ||
      isNonVendorPeerBadgeScan(resolved, scannerKind) ||
      isAttendeeScanningVendor(resolved, scannerKind) ||
      (isVendorLike(scannerKind ?? '') && !isAttendeeScanningVendor(resolved, scannerKind));
    if (!resolved || !shouldLoadConnectionState) {
      setIsConnected(false);
      setRequestSentByMe(false);
      setRequestReceivedFromThem(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [c, s, r] = await Promise.all([
        supabase
          .from('connections')
          .select('id')
          .eq('event_id', badgeEventId)
          .eq('user_id', currentUser.id)
          .eq('connected_user_id', uid)
          .maybeSingle(),
        supabase
          .from('connection_requests')
          .select('id')
          .eq('event_id', badgeEventId)
          .eq('requester_id', currentUser.id)
          .eq('requested_user_id', uid)
          .eq('status', 'pending')
          .maybeSingle(),
        supabase
          .from('connection_requests')
          .select('id')
          .eq('event_id', badgeEventId)
          .eq('requester_id', uid)
          .eq('requested_user_id', currentUser.id)
          .eq('status', 'pending')
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setIsConnected(!!c.data);
      setRequestSentByMe(!!s.data);
      setRequestReceivedFromThem(!!r.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved, scannerKind, currentUser?.id, attendeeScansVendor]);

  useEffect(() => {
    if (currentUser?.id) fetchBlockedUsers(currentUser.id).catch(() => {});
  }, [currentUser?.id, fetchBlockedUsers]);

  const handleConnect = async () => {
    const uid = resolved?.subject.user_id;
    const badgeEventId = resolved?.event_id;
    if (!uid || !currentUser?.id || !badgeEventId) return;
    if (isInteractionBlocked(uid)) {
      Toast.show({
        type: 'info',
        text1: 'Cannot connect',
        text2: 'This person is unavailable for connections.',
      });
      return;
    }
    setConnecting(true);
    try {
      const { error } = await supabase.from('connection_requests').insert({
        event_id: badgeEventId,
        requester_id: currentUser.id,
        requested_user_id: uid,
        status: 'pending',
      });
      if (error) {
        if (error.code === '23505') {
          Toast.show({ type: 'info', text1: 'Request already sent', text2: 'You already sent a connection request.' });
          setRequestSentByMe(true);
          return;
        }
        throw error;
      }
      setRequestSentByMe(true);
      await createNotificationAndPush(
        uid,
        badgeEventId,
        'connection_request',
        'Connection request',
        `${currentUser.full_name ?? 'Someone'} wants to connect with you`,
        { requester_id: currentUser.id }
      );
      Toast.show({ type: 'success', text1: 'Request sent', text2: 'They can accept in Community.' });
    } catch (e) {
      if (__DEV__) console.warn('Connect from badge', e);
      Toast.show({ type: 'error', text1: 'Could not send request' });
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    const raw = params.t;
    const t = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    if (t && t.length > 0) {
      setToken(t);
      setPhase('detail');
      loadDetail(t);
    }
  }, [params.t, loadDetail]);

  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanCooldown) return;
      const tok = parseBadgeTokenFromQrData(data);
      if (!tok) return;
      setScanCooldown(true);
      setToken(tok);
      setPhase('detail');
      loadDetail(tok);
      setTimeout(() => setScanCooldown(false), 2000);
    },
    [scanCooldown, loadDetail]
  );

  const navigateAway = useCallback(() => {
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

  /** Header + Android system back: avoid GO_BACK when there is no stack (deep links). */
  const handleNavigateBack = useCallback(() => {
    if (phase === 'detail' && !urlToken) {
      setPhase('camera');
      setResolved(null);
      setToken(null);
      setError(null);
      setAttendeeVendorMeetings([]);
      return;
    }
    navigateAway();
  }, [phase, urlToken, navigateAway]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        handleNavigateBack();
        return true;
      });
      return () => sub.remove();
    }, [handleNavigateBack])
  );

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setError(null);
    if (isAdminScanner(scannerKind)) {
      const r = await upsertBadgeScan(token, note, false, null);
      setSaving(false);
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.scanner_kind) setScannerKind(r.scanner_kind);
      Toast.show({ type: 'success', text1: 'Saved', text2: 'Notes saved for this scan.' });
      return;
    }
    if (vendorUI && meetingOptions.length > 0) {
      // Sequential saves: each booking upserts its own `badge_scan_meeting_attendance` row; avoids racing the shared `badge_scans` summary row.
      let firstError: string | null = null;
      for (const m of meetingOptions) {
        const meetingId = normalizeMeetingBookingId(m.id);
        if (!meetingId) continue;
        const attendedForMeeting = !!meetingAttendanceById[meetingId];
        const r = await upsertBadgeScan(token, note, attendedForMeeting, meetingId);
        if (r.error) {
          firstError = r.error;
          break;
        }
      }
      if (firstError) {
        setSaving(false);
        setError(firstError);
        return;
      }
      const skipGeneralVisit =
        !!resolved && isVendorScanningVendor(resolved, scannerKind ?? resolved.scanner_kind);
      if (!skipGeneralVisit) {
        const generalVisit = await upsertBadgeScan(token, note, attended, null);
        if (generalVisit.error) {
          setSaving(false);
          setError(generalVisit.error);
          return;
        }
      }
      setSaving(false);
      Toast.show({
        type: 'success',
        text1: 'Saved',
        text2: 'Per-meeting attendance saved.',
      });
      return;
    }
    const v2vNoMeetings =
      !!resolved && isVendorScanningVendor(resolved, scannerKind ?? resolved.scanner_kind);
    const r = await upsertBadgeScan(
      token,
      note,
      v2vNoMeetings ? false : attended,
      selectedMeetingId
    );
    setSaving(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    if (r.scanner_kind) setScannerKind(r.scanner_kind);
    const selectedMeeting = meetingOptions.find((m) => normalizeMeetingBookingId(m.id) === selectedMeetingId);
    const vendorLeadOnly = vendorUI && meetingOptions.length === 0;
    const v2v = !!resolved && isVendorScanningVendor(resolved, scannerKind ?? resolved.scanner_kind);
    Toast.show({
      type: 'success',
      text1: 'Saved',
      text2: selectedMeeting
        ? `${attended ? 'Attended' : 'No-show'} saved for ${formatBadgeMeetingOptionLabel(selectedMeeting)}.`
        : vendorLeadOnly
          ? !v2v && attended
            ? 'General visit attendance saved.'
            : 'Notes saved for this scan.'
          : 'Attendance and notes saved.',
    });
  };

  const vendorUI = isVendorLike(scannerKind);
  const vendorNoMeetingsAtBooth = vendorUI && meetingOptions.length === 0;
  const vendorScanningVendor =
    !!resolved && isVendorScanningVendor(resolved, scannerKind ?? resolved.scanner_kind);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader
        variant="back"
        title={
          adminSimpleBadge || peer ? 'Connect' : attendeeScansVendor ? 'Badge Details' : 'Scan badge'
        }
        onBack={handleNavigateBack}
      />

      {phase === 'camera' && (
        <View style={styles.cameraWrap}>
          {!permission?.granted ? (
            <View style={styles.centerBox}>
              <Text style={styles.hint}>Camera access is needed to scan badge QR codes.</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => requestPermission()}>
                <Text style={styles.primaryBtnText}>Allow camera</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onBarcodeScanned}
            />
          )}
          <Text style={styles.overlayHint}>Point at the QR on the printed badge</Text>
        </View>
      )}

      {phase === 'detail' && (
        <KeyboardAvoidingView
          style={styles.detailKeyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? Math.max(0, insets.top) + 48 : 0}
        >
          <ScrollView
            style={styles.detailScroll}
            contentContainerStyle={[
              styles.detail,
              { paddingBottom: Math.max(160, insets.bottom + 140) },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            nestedScrollEnabled
          >
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
          ) : error ? (
            <Text style={styles.err}>{error}</Text>
          ) : resolved && adminSimpleBadge ? (
            <>
              <Text style={styles.eventName}>{resolved.event.name}</Text>
              <Text style={styles.name}>{resolved.subject.full_name || '—'}</Text>
              <Text style={styles.company}>{resolved.subject.company?.trim() || '—'}</Text>
              <Text style={styles.meta}>{resolved.subject.email || '—'}</Text>

              {requestReceivedFromThem ? (
                <Text style={styles.hintSmall}>
                  They already sent you a connection request. Open their profile to accept, or view Community.
                </Text>
              ) : null}

              {isConnected ? (
                <Text style={styles.mutedLine}>You’re connected — open Community or their profile to message them.</Text>
              ) : requestSentByMe ? (
                <Text style={styles.mutedLine}>Connection request sent — they’ll be notified in Community.</Text>
              ) : (
                <TouchableOpacity style={styles.primaryBtn} onPress={handleConnect} disabled={connecting}>
                  <View style={styles.connectBtnInner}>
                    <UserPlus size={20} color={colors.textOnPrimary} />
                    <Text style={styles.primaryBtnText}>{connecting ? 'Sending…' : 'Connect'}</Text>
                  </View>
                </TouchableOpacity>
              )}

              {resolved.subject.user_id ? (
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => router.push(`/(tabs)/feed/user/${resolved.subject.user_id}` as any)}
                >
                  <Text style={styles.secondaryBtnText}>View full profile</Text>
                </Pressable>
              ) : null}

              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={styles.input}
                placeholder="Notes…"
                placeholderTextColor={colors.textMuted}
                multiline
                value={note}
                onChangeText={setNote}
              />
              <TouchableOpacity style={styles.primaryBtn} onPress={handleSave} disabled={saving}>
                <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </>
          ) : resolved && peer ? (
            <>
              <Text style={styles.eventName}>{resolved.event.name}</Text>
              <Text style={styles.name}>{resolved.subject.full_name || '—'}</Text>
              <Text style={styles.company}>{resolved.subject.company?.trim() || '—'}</Text>
              <Text style={styles.meta}>{resolved.subject.email || '—'}</Text>

              {requestReceivedFromThem ? (
                <Text style={styles.hintSmall}>
                  They already sent you a connection request. Open their profile to accept, or view Community.
                </Text>
              ) : null}

              {isConnected ? (
                <Text style={styles.mutedLine}>You’re connected — open Community or their profile to message them.</Text>
              ) : requestSentByMe ? (
                <Text style={styles.mutedLine}>Connection request sent — they’ll be notified in Community.</Text>
              ) : (
                <TouchableOpacity style={styles.primaryBtn} onPress={handleConnect} disabled={connecting}>
                  <View style={styles.connectBtnInner}>
                    <UserPlus size={20} color={colors.textOnPrimary} />
                    <Text style={styles.primaryBtnText}>{connecting ? 'Sending…' : 'Connect'}</Text>
                  </View>
                </TouchableOpacity>
              )}

              {resolved.subject.user_id ? (
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => router.push(`/(tabs)/feed/user/${resolved.subject.user_id}` as any)}
                >
                  <Text style={styles.secondaryBtnText}>View full profile</Text>
                </Pressable>
              ) : null}
            </>
          ) : resolved && attendeeScansVendor ? (
            <>
              <Text style={styles.eventName}>{resolved.event.name}</Text>
              <Text style={styles.name}>{resolved.subject.full_name || '—'}</Text>
              <Text style={styles.company}>{resolved.subject.company?.trim() || '—'}</Text>
              <Text style={styles.meta}>{resolved.subject.email || '—'}</Text>

              {attendeeVendorMeetings.length > 0 ? (
                <>
                  <Text style={styles.label}>Your meetings with them</Text>
                  {attendeeVendorMeetings.map((m) => (
                    <View key={String(m.id)} style={styles.meetingRowStatic}>
                      <Text style={styles.meetingLabel}>{formatBadgeMeetingOptionLabel(m)}</Text>
                    </View>
                  ))}
                </>
              ) : (
                <Text style={styles.hintSmall}>No 1:1 meetings scheduled with this vendor&apos;s booth yet.</Text>
              )}

              {resolved.subject.user_id ? (
                <>
                  {requestReceivedFromThem ? (
                    <Text style={styles.hintSmall}>
                      They already sent you a connection request. Open their profile to accept, or view Community.
                    </Text>
                  ) : null}
                  {isConnected ? (
                    <Text style={styles.mutedLine}>You’re connected — open their full profile to message them.</Text>
                  ) : requestSentByMe ? (
                    <Text style={styles.mutedLine}>Connection request sent — they’ll be notified in Community.</Text>
                  ) : (
                    <TouchableOpacity style={styles.primaryBtn} onPress={handleConnect} disabled={connecting}>
                      <View style={styles.connectBtnInner}>
                        <UserPlus size={20} color={colors.textOnPrimary} />
                        <Text style={styles.primaryBtnText}>{connecting ? 'Sending…' : 'Connect'}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                  <Pressable
                    style={styles.secondaryBtn}
                    onPress={() => router.push(`/(tabs)/feed/user/${resolved.subject.user_id}` as any)}
                  >
                    <Text style={styles.secondaryBtnText}>View full profile</Text>
                  </Pressable>
                </>
              ) : null}
            </>
          ) : resolved ? (
            vendorNoMeetingsAtBooth ? (
              <>
                <Text style={styles.eventName}>{resolved.event.name}</Text>
                <Text style={styles.name}>{resolved.subject.full_name || '—'}</Text>
                <Text style={styles.company}>{resolved.subject.company || '—'}</Text>
                <Text style={styles.meta}>{resolved.subject.email}</Text>
                {!vendorScanningVendor ? (
                  <>
                    <Text style={styles.peerHint}>
                      You have no scheduled meeting with this person at your booth. Use the toggle below for a walk-in
                      or general booth visit.
                    </Text>
                    <Text style={styles.label}>Mark attendance</Text>
                    <View style={styles.meetingToggleRow}>
                      <View style={styles.labelCol}>
                        <Text style={styles.meetingLabel}>Unscheduled / general visit</Text>
                      </View>
                      <Switch
                        value={attended}
                        onValueChange={onAttendedChange}
                        trackColor={{ false: colors.border, true: colors.primaryFaded }}
                        thumbColor={attended ? colors.primary : colors.surface}
                        ios_backgroundColor={colors.border}
                      />
                    </View>
                  </>
                ) : null}
                {requestReceivedFromThem ? (
                  <Text style={styles.hintSmall}>
                    They already sent you a connection request. Open their profile to accept, or view Community.
                  </Text>
                ) : null}
                {isConnected ? (
                  <Pressable
                    style={styles.secondaryBtn}
                    onPress={() => router.push(`/(tabs)/profile/chat/${resolved.subject.user_id}` as any)}
                  >
                    <MessageCircle size={20} color={colors.primary} />
                    <Text style={styles.secondaryBtnText}>Message</Text>
                  </Pressable>
                ) : requestSentByMe ? (
                  <Text style={styles.mutedLine}>Connection request sent — they’ll be notified in Community.</Text>
                ) : (
                  <TouchableOpacity style={styles.primaryBtn} onPress={handleConnect} disabled={connecting}>
                    <View style={styles.connectBtnInner}>
                      <UserPlus size={20} color={colors.textOnPrimary} />
                      <Text style={styles.primaryBtnText}>{connecting ? 'Sending…' : 'Connect'}</Text>
                    </View>
                  </TouchableOpacity>
                )}
                {resolved.subject.user_id ? (
                  <Pressable
                    style={styles.secondaryBtn}
                    onPress={() => router.push(`/(tabs)/feed/user/${resolved.subject.user_id}` as any)}
                  >
                    <Text style={styles.secondaryBtnText}>View full profile</Text>
                  </Pressable>
                ) : null}

                <Text style={styles.label}>Notes</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Lead notes…"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  value={note}
                  onChangeText={setNote}
                />
                <TouchableOpacity style={styles.primaryBtn} onPress={handleSave} disabled={saving}>
                  <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
                </TouchableOpacity>
              </>
            ) : (
            <>
              <Text style={styles.eventName}>{resolved.event.name}</Text>
              <Text style={styles.name}>{resolved.subject.full_name || '—'}</Text>
              <Text style={styles.company}>{resolved.subject.company || '—'}</Text>
              <Text style={styles.meta}>{resolved.subject.email}</Text>

              {vendorUI && meetingOptions.length > 0 ? (
                <Text style={styles.hintSmall}>
                  {vendorScanningVendor
                    ? 'Meetings below are where this person is booked as an attendee at your booth(s).'
                    : 'Below are the meetings assigned to you.'}
                </Text>
              ) : null}

              {meetingOptions.length > 0 ? (
                <>
                  <Text style={styles.label}>Mark attendance</Text>
                  {vendorUI ? (
                    <>
                      {meetingOptions.map((m) => {
                        const rowId = normalizeMeetingBookingId(m.id);
                        if (!rowId) return null;
                        const on = !!meetingAttendanceById[rowId];
                        return (
                          <View key={rowId} style={styles.meetingToggleRow}>
                            <View style={styles.labelCol}>
                              <Text style={styles.meetingLabel}>{formatBadgeMeetingOptionLabel(m)}</Text>
                            </View>
                            <Switch
                              value={on}
                              onValueChange={(next) => setMeetingAttended(rowId, next)}
                              trackColor={{ false: colors.border, true: colors.primaryFaded }}
                              thumbColor={on ? colors.primary : colors.surface}
                              ios_backgroundColor={colors.border}
                            />
                          </View>
                        );
                      })}
                      {!vendorScanningVendor ? (
                        <View style={styles.meetingToggleRow}>
                          <View style={styles.labelCol}>
                            <Text style={styles.meetingLabel}>Unscheduled / general visit</Text>
                          </View>
                          <Switch
                            value={attended}
                            onValueChange={onAttendedChange}
                            trackColor={{ false: colors.border, true: colors.primaryFaded }}
                            thumbColor={attended ? colors.primary : colors.surface}
                            ios_backgroundColor={colors.border}
                          />
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Text style={styles.hintSmall}>
                        {meetingOptions.length > 1
                          ? 'This person has several booth meetings scheduled. Choose which one this check-in is for, or leave Not specified for a general visit.'
                          : 'Choose the meeting this check-in is for, or Not specified for a general visit.'}
                      </Text>
                      {meetingOptions.map((m) => {
                        const rowId = normalizeMeetingBookingId(m.id);
                        const selected = rowId != null && selectedMeetingId === rowId;
                        return (
                          <Pressable
                            key={rowId ?? String(m.id)}
                            style={[styles.meetingRow, selected && styles.meetingRowSelected]}
                            onPress={() => {
                              if (rowId) setSelectedMeetingId(rowId);
                            }}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                          >
                            <View style={styles.radioOuter}>{selected ? <View style={styles.radioInner} /> : null}</View>
                            <Text style={styles.meetingLabel}>{formatBadgeMeetingOptionLabel(m)}</Text>
                          </Pressable>
                        );
                      })}
                      <Pressable
                        style={[styles.meetingRow, selectedMeetingId === null && styles.meetingRowSelected]}
                        onPress={() => setSelectedMeetingId(null)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: selectedMeetingId === null }}
                      >
                        <View style={styles.radioOuter}>{selectedMeetingId === null ? <View style={styles.radioInner} /> : null}</View>
                        <Text style={styles.meetingLabel}>Not specified (general / networking)</Text>
                      </Pressable>
                    </>
                  )}
                </>
              ) : null}

              {!vendorUI || meetingOptions.length === 0 ? (
                <View style={styles.row}>
                  <View style={styles.labelCol}>
                    <Text style={styles.label}>Attended 1:1 (showed up)</Text>
                    <Text style={styles.hintSmall}>
                      {meetingOptions.length > 0
                        ? 'Use if they showed up for this visit overall; turn off for a no-show. When meetings are listed above, pick one or Not specified to match this to a slot.'
                        : 'On if they showed up for this visit; turn off for a no-show.'}
                    </Text>
                  </View>
                  <View style={styles.switchWrap}>
                    <Switch
                      value={attended}
                      onValueChange={onAttendedChange}
                      trackColor={{ false: colors.border, true: colors.primaryFaded }}
                      thumbColor={attended ? colors.primary : colors.surface}
                      ios_backgroundColor={colors.border}
                    />
                  </View>
                </View>
              ) : null}

              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={styles.input}
                placeholder={vendorUI ? 'Lead notes…' : 'Notes…'}
                placeholderTextColor={colors.textMuted}
                multiline
                value={note}
                onChangeText={setNote}
              />

              <TouchableOpacity style={styles.primaryBtn} onPress={handleSave} disabled={saving}>
                <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>

              {!vendorUI && resolved.subject.user_id ? (
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => router.push(`/(tabs)/profile/chat/${resolved.subject.user_id}` as any)}
                >
                  <MessageCircle size={20} color={colors.primary} />
                  <Text style={styles.secondaryBtnText}>Message</Text>
                </Pressable>
              ) : null}

              {vendorUI && resolved.subject.email ? (
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={() => Linking.openURL(`mailto:${resolved.subject.email}`)}
                >
                  <Text style={styles.linkText}>{vendorScanningVendor ? 'Email vendor' : 'Email attendee'}</Text>
                </TouchableOpacity>
              ) : null}
            </>
            )
          ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  cameraWrap: { flex: 1, minHeight: 360 },
  centerBox: { flex: 1, justifyContent: 'center', padding: 24 },
  overlayHint: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    textAlign: 'center',
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  hint: { color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  detailKeyboard: { flex: 1 },
  detailScroll: { flex: 1 },
  detail: { padding: 20, gap: 12 },
  labelCol: { flex: 1, marginRight: 8, minWidth: 0 },
  /** Larger touch area so Switch isn’t lost to ScrollView gestures (Android). */
  switchWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
    paddingLeft: 8,
    minHeight: 48,
    minWidth: 56,
  },
  hintSmall: { fontSize: 12, color: colors.textSecondary, lineHeight: 16, marginTop: 4 },
  meetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  meetingRowSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  meetingToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  meetingRowStatic: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  meetingLabel: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 20 },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  eventName: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  company: { fontSize: 17, color: colors.text },
  meta: { fontSize: 14, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    minHeight: 88,
    textAlignVertical: 'top',
    color: colors.text,
    backgroundColor: colors.surface,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  secondaryBtnText: { color: colors.primary, fontWeight: '600', fontSize: 16 },
  linkBtn: { paddingVertical: 8, alignItems: 'center' },
  linkText: { color: colors.primary, fontWeight: '600' },
  err: { color: colors.danger, marginTop: 16, paddingHorizontal: 8 },
  peerHint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  mutedLine: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginVertical: 8 },
  connectBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
