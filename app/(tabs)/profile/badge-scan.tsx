import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
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
import { CheckCircle2, MessageCircle, UserPlus } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import ProfileStackScreenHeader from '../../../components/ProfileStackScreenHeader';
import Avatar from '../../../components/Avatar';
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
  normalizeMeetingBookingId,
  formatBadgeMeetingOptionLabel,
  type ResolvedBadge,
  type BadgeMeetingOption,
} from '../../../lib/badgeRpc';
import {
  fetchRepresentativesForVendorUser,
  type BoothRepresentative,
  type VendorBoothSummary,
} from '../../../lib/vendorBoothReps';
import { effectiveScannerKind } from '../../../lib/rolePreview';
import { useRolePreviewStore } from '../../../stores/rolePreviewStore';
import { useEventStore } from '../../../stores/eventStore';
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
  const { currentEvent } = useEventStore();
  const previewRole = useRolePreviewStore((s) => s.previewRole);
  const isPlatformAdmin = currentUser?.is_platform_admin === true;
  const { fetchBlockedUsers, isInteractionBlocked } = useBlockStore();
  const [permission, requestPermission] = useCameraPermissions();
  const isFocused = useIsFocused();
  const [phase, setPhase] = useState<'camera' | 'detail'>(() => (params.t ? 'detail' : 'camera'));
  const [token, setToken] = useState<string | null>(params.t ?? null);
  const [resolved, setResolved] = useState<ResolvedBadge | null>(null);
  const meetingEventTz =
    resolved?.event_id && currentEvent?.id === resolved.event_id
      ? currentEvent.reminder_timezone
      : currentEvent?.reminder_timezone;
  const [scannerKind, setScannerKind] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [attended, setAttended] = useState(false);
  const [meetingOptions, setMeetingOptions] = useState<BadgeMeetingOption[]>([]);
  const [attendeeVendorMeetings, setAttendeeVendorMeetings] = useState<BadgeMeetingOption[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [scanCooldown, setScanCooldown] = useState(false);
  const [savedBannerText, setSavedBannerText] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [requestSentByMe, setRequestSentByMe] = useState(false);
  const [requestReceivedFromThem, setRequestReceivedFromThem] = useState(false);
  const [incomingRequestId, setIncomingRequestId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [respondingToConnection, setRespondingToConnection] = useState(false);
  const [vendorBooths, setVendorBooths] = useState<VendorBoothSummary[]>([]);
  const [vendorRepresentatives, setVendorRepresentatives] = useState<BoothRepresentative[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(false);
  useEffect(() => {
    if (!savedBannerText) return;
    const t = setTimeout(() => setSavedBannerText(null), 4000);
    return () => clearTimeout(t);
  }, [savedBannerText]);

  useFocusEffect(
    useCallback(() => {
      if (urlToken) return;
      setPhase('camera');
      setResolved(null);
      setToken(null);
      setError(null);
      setScanCooldown(false);
    }, [urlToken])
  );

  useFocusEffect(
    useCallback(() => {
      if (phase !== 'camera' || !isFocused) return;
      if (permission?.granted) return;
      if (permission?.canAskAgain === false) return;
      void requestPermission();
    }, [phase, isFocused, permission?.granted, permission?.canAskAgain, requestPermission])
  );

  const renderCameraPhase = () => {
    if (permission == null) {
      return (
        <View style={styles.cameraWrap}>
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.hint}>Starting camera…</Text>
          </View>
        </View>
      );
    }
    if (!permission.granted) {
      return (
        <View style={styles.cameraWrap}>
          <View style={styles.centerBox}>
            <Text style={styles.hint}>Camera access is needed to scan badge QR codes.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => void requestPermission()}>
              <Text style={styles.primaryBtnText}>Allow camera</Text>
            </TouchableOpacity>
            {permission.canAskAgain === false ? (
              <TouchableOpacity style={styles.linkBtn} onPress={() => Linking.openSettings()}>
                <Text style={styles.linkText}>Open Settings to enable camera</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      );
    }
    return (
      <View style={styles.cameraWrap}>
        {isFocused ? (
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanCooldown ? undefined : onBarcodeScanned}
          />
        ) : (
          <View style={styles.cameraLoading}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        )}
        <Text style={styles.overlayHint}>Point at the QR on the printed badge</Text>
      </View>
    );
  };

  const confirmSaved = useCallback((detail: string) => {
    setSavedBannerText(detail);
    Toast.show({
      type: 'success',
      text1: 'Notes saved',
      text2: detail,
      visibilityTime: 4000,
    });
  }, []);

  const retryScan = useCallback(() => {
    setError(null);
    setResolved(null);
    setToken(null);
    setPhase('camera');
  }, []);

  const loadDetail = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    setSavedBannerText(null);
    setMeetingOptions([]);
    setAttendeeVendorMeetings([]);
    setSelectedMeetingId(null);
    setAttended(false);
    setNote('');
    setVendorBooths([]);
    setVendorRepresentatives([]);
    const { data, error: err } = await resolveBadgeToken(tok);
    if (err || !data) {
      setLoading(false);
      setError(err || 'Could not load badge.');
      setResolved(null);
      return;
    }
    setResolved(data);
    const kind = effectiveScannerKind(data.scanner_kind, isPlatformAdmin, previewRole);
    setScannerKind(kind);
    setPhase('detail');
    const adminScan = isAdminScanner(kind);
    const vendorScan = isVendorLike(kind);
    const peerScan = isNonVendorPeerBadgeScan(data, kind);
    const attendeeVendorScan = isAttendeeScanningVendor(data, kind);
    if (adminScan) {
      const prev = await fetchMyBadgeScanForSubject(data.event_id, data.subject.user_id);
      if (prev) setNote(prev.note ?? '');
      setLoading(false);
      return;
    }
    if (data.subject_kind === 'vendor' && data.subject.user_id) {
      const vendorInfo = await fetchRepresentativesForVendorUser(data.event_id, data.subject.user_id);
      setVendorBooths(vendorInfo.booths);
      setVendorRepresentatives(vendorInfo.representatives);
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
    } else if (!peerScan && !vendorScan) {
      const opt = await listBadgeMeetingOptions(tok);
      if (opt.error) {
        if (__DEV__) console.warn('listBadgeMeetingOptions', opt.error);
        setMeetingOptions([]);
      } else if (opt.rows && opt.rows.length > 0) {
        const normalizedRows = opt.rows
          .map((row) => {
            const id = normalizeMeetingBookingId(row.id);
            return id ? { ...row, id } : null;
          })
          .filter((row): row is BadgeMeetingOption => !!row);
        setMeetingOptions(normalizedRows);
      }
    }
    /** Restore saved note + general visit toggle (same `badge_scans` row `upsert_badge_scan` writes). */
    if (!peerScan && !attendeeVendorScan) {
      const prev = await fetchMyBadgeScanForSubject(data.event_id, data.subject.user_id);
      if (prev) {
        setAttended(vendorScan ? false : prev.attended_meeting);
        setNote(prev.note);
      }
    }
    setLoading(false);
  }, [isPlatformAdmin, previewRole]);

  useEffect(() => {
    if (phase !== 'detail' || !token) return;
    void loadDetail(token);
  }, [previewRole, phase, token, loadDetail]);

  const onAttendedChange = useCallback((next: boolean) => {
    setAttended(next);
  }, []);

  const adminSimpleBadge = !!resolved && isAdminScanner(scannerKind);
  const peer = !!resolved && isNonVendorPeerBadgeScan(resolved, scannerKind) && !adminSimpleBadge;
  const attendeeScansVendor = !!resolved && isAttendeeScanningVendor(resolved, scannerKind);
  const vendorUI = isVendorLike(scannerKind);
  const subjectUserId = resolved?.subject.user_id;
  const canConnectWithSubject = !!subjectUserId && subjectUserId !== currentUser?.id;

  useEffect(() => {
    const uid = resolved?.subject.user_id;
    /** Badge QR is always for the token's event — not necessarily the tab's `currentEvent`. */
    const badgeEventId = resolved?.event_id;
    if (!uid || !currentUser?.id || !badgeEventId || uid === currentUser.id) {
      setIsConnected(false);
      setRequestSentByMe(false);
      setRequestReceivedFromThem(false);
      setIncomingRequestId(null);
      setConnectionLoading(false);
      return;
    }
    let cancelled = false;
    setConnectionLoading(true);
    (async () => {
      const [c1, c2, s, r] = await Promise.all([
        supabase
          .from('connections')
          .select('id')
          .eq('event_id', badgeEventId)
          .eq('user_id', currentUser.id)
          .eq('connected_user_id', uid)
          .maybeSingle(),
        supabase
          .from('connections')
          .select('id')
          .eq('event_id', badgeEventId)
          .eq('user_id', uid)
          .eq('connected_user_id', currentUser.id)
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
      setIsConnected(!!c1.data || !!c2.data);
      setRequestSentByMe(!!s.data);
      setRequestReceivedFromThem(!!r.data);
      setIncomingRequestId((r.data as { id?: string } | null)?.id ?? null);
      setConnectionLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [resolved, currentUser?.id]);

  useEffect(() => {
    if (currentUser?.id) fetchBlockedUsers(currentUser.id).catch(() => {});
  }, [currentUser?.id, fetchBlockedUsers]);

  const renderConnectionStatusBadge = () => {
    if (!canConnectWithSubject) return null;
    if (connectionLoading) {
      return (
        <View style={styles.connectionBadgeRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.connectionBadgeTextMuted}>Checking connection…</Text>
        </View>
      );
    }
    if (isConnected) {
      return (
        <View style={[styles.connectionBadge, styles.connectionBadgeConnected]}>
          <Text style={styles.connectionBadgeLabel}>Connected</Text>
          <Text style={styles.connectionBadgeHint}>You can message each other in Community.</Text>
        </View>
      );
    }
    if (requestReceivedFromThem) {
      return (
        <View style={[styles.connectionBadge, styles.connectionBadgeReceived]}>
          <Text style={styles.connectionBadgeLabel}>Request received</Text>
          <Text style={styles.connectionBadgeHint}>They want to connect. Accept or decline below.</Text>
        </View>
      );
    }
    if (requestSentByMe) {
      return (
        <View style={[styles.connectionBadge, styles.connectionBadgePending]}>
          <Text style={styles.connectionBadgeLabel}>Request sent</Text>
          <Text style={styles.connectionBadgeHint}>Waiting for them to accept in Community.</Text>
        </View>
      );
    }
    return (
      <View style={[styles.connectionBadge, styles.connectionBadgeNew]}>
        <Text style={styles.connectionBadgeLabel}>Not connected yet</Text>
        <Text style={styles.connectionBadgeHint}>Tap Connect below to send a request.</Text>
      </View>
    );
  };

  const renderVendorRepresentatives = () => {
    if (resolved?.subject_kind !== 'vendor') return null;
    if (vendorBooths.length === 0 && vendorRepresentatives.length === 0) return null;
    return (
      <View style={styles.vendorRepSection}>
        {vendorBooths.length > 0 ? (
          <>
            <Text style={styles.label}>Solution provider</Text>
            {vendorBooths.map((b) => (
              <Text key={b.booth_id} style={styles.vendorBoothName}>
                {b.vendor_name}
                {b.booth_location ? ` · ${b.booth_location}` : ''}
              </Text>
            ))}
          </>
        ) : null}
        {vendorRepresentatives.length > 0 ? (
          <>
            <Text style={styles.label}>Representatives</Text>
            {vendorRepresentatives.map((rep) => {
              const subtitle = [rep.title, rep.company].filter(Boolean).join(' · ');
              return (
                <Pressable
                  key={rep.user_id}
                  style={styles.repRow}
                  onPress={() => router.push(`/(tabs)/feed/user/${rep.user_id}` as any)}
                >
                  <Avatar uri={rep.avatar_url} name={rep.full_name} size={40} />
                  <View style={styles.repTextCol}>
                    <Text style={styles.repName}>
                      {rep.full_name}
                    </Text>
                    {subtitle ? <Text style={styles.hintSmall}>{subtitle}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </>
        ) : null}
      </View>
    );
  };

  const renderConnectActions = () => {
    if (!canConnectWithSubject || !subjectUserId) return null;
    return (
      <>
        {isConnected ? (
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => router.push(`/(tabs)/profile/chat/${subjectUserId}` as any)}
          >
            <MessageCircle size={20} color={colors.primary} />
            <Text style={styles.secondaryBtnText}>Message</Text>
          </Pressable>
        ) : requestReceivedFromThem ? (
          <View style={styles.connectionActionRow}>
            <TouchableOpacity
              style={[styles.primaryBtn, styles.connectionActionBtn]}
              onPress={handleAcceptRequest}
              disabled={respondingToConnection}
            >
              <Text style={styles.primaryBtnText}>{respondingToConnection ? 'Working…' : 'Accept'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, styles.connectionActionBtn]}
              onPress={handleDeclineRequest}
              disabled={respondingToConnection}
            >
              <Text style={styles.secondaryBtnText}>Decline</Text>
            </TouchableOpacity>
          </View>
        ) : requestSentByMe ? null : (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleConnect} disabled={connecting}>
            <View style={styles.connectBtnInner}>
              <UserPlus size={20} color={colors.textOnPrimary} />
              <Text style={styles.primaryBtnText}>{connecting ? 'Sending…' : 'Connect'}</Text>
            </View>
          </TouchableOpacity>
        )}
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => router.push(`/(tabs)/feed/user/${subjectUserId}` as any)}
        >
          <Text style={styles.secondaryBtnText}>View full profile</Text>
        </Pressable>
      </>
    );
  };

  const handleAcceptRequest = async () => {
    const uid = resolved?.subject.user_id;
    const badgeEventId = resolved?.event_id;
    if (!uid || !currentUser?.id || !badgeEventId) return;
    if (isInteractionBlocked(uid)) {
      Toast.show({
        type: 'info',
        text1: 'Cannot accept',
        text2: 'This person is unavailable for connections.',
      });
      return;
    }
    setRespondingToConnection(true);
    try {
      let requestId = incomingRequestId;
      if (!requestId) {
        const { data: req, error: selectErr } = await supabase
          .from('connection_requests')
          .select('id')
          .eq('event_id', badgeEventId)
          .eq('requester_id', uid)
          .eq('requested_user_id', currentUser.id)
          .eq('status', 'pending')
          .maybeSingle();
        if (selectErr) throw selectErr;
        requestId = (req as { id?: string } | null)?.id ?? null;
      }
      if (!requestId) {
        Toast.show({
          type: 'info',
          text1: 'Request not found',
          text2: 'It may have been accepted or declined already.',
        });
        setRequestReceivedFromThem(false);
        setIncomingRequestId(null);
        return;
      }
      const { error: updateErr } = await supabase
        .from('connection_requests')
        .update({ status: 'accepted' })
        .eq('id', requestId);
      if (updateErr) throw updateErr;
      const { error: ins1 } = await supabase.from('connections').insert({
        event_id: badgeEventId,
        user_id: currentUser.id,
        connected_user_id: uid,
      });
      if (ins1) throw ins1;
      const { error: ins2 } = await supabase.from('connections').insert({
        event_id: badgeEventId,
        user_id: uid,
        connected_user_id: currentUser.id,
      });
      if (ins2) throw ins2;
      await createNotificationAndPush(
        uid,
        badgeEventId,
        'system',
        'Connection accepted',
        `${currentUser.full_name ?? 'Someone'} accepted your connection request`,
        { chat_user_id: currentUser.id }
      );
      setIsConnected(true);
      setRequestReceivedFromThem(false);
      setIncomingRequestId(null);
      Toast.show({ type: 'success', text1: 'Connected', text2: "You're connected — you can message them now." });
    } catch (e) {
      if (__DEV__) console.warn('Accept from badge', e);
      Toast.show({ type: 'error', text1: 'Could not accept', text2: 'Please try again.' });
    } finally {
      setRespondingToConnection(false);
    }
  };

  const handleDeclineRequest = async () => {
    const uid = resolved?.subject.user_id;
    const badgeEventId = resolved?.event_id;
    if (!uid || !currentUser?.id || !badgeEventId) return;
    setRespondingToConnection(true);
    try {
      let requestId = incomingRequestId;
      if (!requestId) {
        const { data: req } = await supabase
          .from('connection_requests')
          .select('id')
          .eq('event_id', badgeEventId)
          .eq('requester_id', uid)
          .eq('requested_user_id', currentUser.id)
          .eq('status', 'pending')
          .maybeSingle();
        requestId = (req as { id?: string } | null)?.id ?? null;
      }
      if (requestId) {
        const { error: updateErr } = await supabase
          .from('connection_requests')
          .update({ status: 'declined' })
          .eq('id', requestId);
        if (updateErr) throw updateErr;
      }
      setRequestReceivedFromThem(false);
      setIncomingRequestId(null);
      Toast.show({ type: 'success', text1: 'Declined', text2: 'Connection request declined.' });
    } catch (e) {
      if (__DEV__) console.warn('Decline from badge', e);
      Toast.show({ type: 'error', text1: 'Could not decline', text2: 'Please try again.' });
    } finally {
      setRespondingToConnection(false);
    }
  };

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
      confirmSaved('Your notes were saved.');
      return;
    }
    if (vendorUI) {
      const r = await upsertBadgeScan(token, note, false, null);
      setSaving(false);
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.scanner_kind) setScannerKind(r.scanner_kind);
      const who = resolved?.subject.full_name?.trim();
      confirmSaved(who ? `Lead notes saved for ${who}.` : 'Your lead notes were saved.');
      return;
    }
    const r = await upsertBadgeScan(token, note, attended, selectedMeetingId);
    setSaving(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    if (r.scanner_kind) setScannerKind(r.scanner_kind);
    const selectedMeeting = meetingOptions.find((m) => normalizeMeetingBookingId(m.id) === selectedMeetingId);
    const detail = selectedMeeting
      ? `${attended ? 'Showed up' : 'No-show'} saved for ${formatBadgeMeetingOptionLabel(selectedMeeting, meetingEventTz)}.`
      : attended
        ? 'Visit marked as showed up.'
        : 'Your notes were saved.';
    confirmSaved(detail);
  };

  const badgeSubjectHeader = (showVendorReps = true) => (
    <>
      <Text style={styles.eventName}>{resolved!.event.name}</Text>
      <Text style={styles.name}>{resolved!.subject.full_name || '—'}</Text>
      <Text style={styles.company}>{resolved!.subject.company?.trim() || '—'}</Text>
      <Text style={styles.meta}>{resolved!.subject.email || '—'}</Text>
      {showVendorReps ? renderVendorRepresentatives() : null}
      {renderConnectionStatusBadge()}
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader
        variant="back"
        title={canConnectWithSubject ? 'Connect' : attendeeScansVendor ? 'Badge Details' : 'Scan badge'}
        onBack={handleNavigateBack}
      />

      {phase === 'camera' ? renderCameraPhase() : null}

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
          {savedBannerText ? (
            <View style={styles.savedBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <CheckCircle2 size={22} color="#15803d" strokeWidth={2.5} />
              <View style={styles.savedBannerText}>
                <Text style={styles.savedBannerTitle}>Saved</Text>
                <Text style={styles.savedBannerBody}>{savedBannerText}</Text>
              </View>
            </View>
          ) : null}
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
          ) : error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Could not scan badge</Text>
              <Text style={styles.errorBody}>{error}</Text>
              <TouchableOpacity style={styles.secondaryBtn} onPress={retryScan} accessibilityRole="button">
                <Text style={styles.secondaryBtnText}>Scan another badge</Text>
              </TouchableOpacity>
            </View>
          ) : resolved && adminSimpleBadge ? (
            <>
              {badgeSubjectHeader()}
              {renderConnectActions()}

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
              {badgeSubjectHeader()}
              {renderConnectActions()}
            </>
          ) : resolved && attendeeScansVendor ? (
            <>
              {badgeSubjectHeader()}

              {attendeeVendorMeetings.length > 0 ? (
                <>
                  <Text style={styles.label}>Your meetings with them</Text>
                  {attendeeVendorMeetings.map((m) => (
                    <View key={String(m.id)} style={styles.meetingRowStatic}>
                      <Text style={styles.meetingLabel}>{formatBadgeMeetingOptionLabel(m, meetingEventTz)}</Text>
                    </View>
                  ))}
                </>
              ) : (
                <Text style={styles.hintSmall}>No 1:1 meetings scheduled with this vendor&apos;s booth yet.</Text>
              )}

              {renderConnectActions()}
            </>
          ) : resolved ? (
            vendorUI ? (
              <>
                {badgeSubjectHeader()}
                {renderConnectActions()}
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
                  <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save notes'}</Text>
                </TouchableOpacity>
                {resolved.subject.email ? (
                  <TouchableOpacity
                    style={styles.linkBtn}
                    onPress={() => Linking.openURL(`mailto:${resolved.subject.email}`)}
                  >
                    <Text style={styles.linkText}>
                      {isVendorScanningVendor(resolved, scannerKind ?? resolved.scanner_kind)
                        ? 'Email vendor'
                        : 'Email attendee'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : (
              <>
                {badgeSubjectHeader(false)}
                {renderConnectActions()}

                {meetingOptions.length > 0 ? (
                  <>
                    <Text style={styles.label}>1:1 meeting</Text>
                    <Text style={styles.hintSmall}>
                      {meetingOptions.length > 1
                        ? 'This person has several booth meetings scheduled. Choose which one this scan is for, or leave Not specified for a general visit.'
                        : 'Choose the meeting this scan is for, or Not specified for a general visit.'}
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
                          <Text style={styles.meetingLabel}>{formatBadgeMeetingOptionLabel(m, meetingEventTz)}</Text>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      style={[styles.meetingRow, selectedMeetingId === null && styles.meetingRowSelected]}
                      onPress={() => setSelectedMeetingId(null)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: selectedMeetingId === null }}
                    >
                      <View style={styles.radioOuter}>
                        {selectedMeetingId === null ? <View style={styles.radioInner} /> : null}
                      </View>
                      <Text style={styles.meetingLabel}>Not specified (general / networking)</Text>
                    </Pressable>
                  </>
                ) : null}

                <View style={styles.row}>
                  <View style={styles.labelCol}>
                    <Text style={styles.label}>Showed up for 1:1</Text>
                    <Text style={styles.hintSmall}>
                      {meetingOptions.length > 0
                        ? 'On if they came to this visit; off for a no-show. Pick a meeting above or Not specified for a general visit.'
                        : 'On if they came to this visit; off for a no-show.'}
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
  cameraWrap: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    minHeight: 320,
  },
  cameraLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
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
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  savedBannerText: { flex: 1 },
  savedBannerTitle: { fontSize: 16, fontWeight: '800', color: '#15803d', marginBottom: 4 },
  savedBannerBody: { fontSize: 14, color: colors.text, lineHeight: 20 },
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
  errorCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 10,
  },
  errorTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  errorBody: { fontSize: 15, color: colors.textSecondary, lineHeight: 22 },
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
  connectionBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  connectionBadgeTextMuted: { fontSize: 13, color: colors.textSecondary },
  connectionBadge: {
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  connectionBadgeConnected: {
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
  },
  connectionBadgePending: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
  },
  connectionBadgeReceived: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
  },
  connectionBadgeNew: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  connectionBadgeLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
  connectionBadgeHint: { fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 16 },
  connectionActionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  connectionActionBtn: { flex: 1, marginTop: 0 },
  vendorRepSection: { gap: 8, marginTop: 4 },
  vendorBoothName: { fontSize: 15, fontWeight: '700', color: colors.text },
  repRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  repTextCol: { flex: 1, minWidth: 0 },
  repName: { fontSize: 15, fontWeight: '700', color: colors.text },
});
