import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { AlertCircle, CheckCircle2 } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import ProfileStackScreenHeader from '../../../components/ProfileStackScreenHeader';
import { colors } from '../../../constants/colors';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { supabase } from '../../../lib/supabase';
import { parseBadgeTokenFromQrData } from '../../../lib/badgeRpc';
import { listSessionsForCheckIn, recordSessionCheckIn } from '../../../lib/sessionCheckInRpc';
import { effectiveCanShowSessionCheckIn } from '../../../lib/rolePreview';
import { useRolePreviewStore } from '../../../stores/rolePreviewStore';

type LastScanKind = 'checked_in' | 'already_scanned' | null;

function parseInitialCount(raw: string | string[] | undefined): number {
  const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export default function SessionCheckInScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const isPlatformAdmin = user?.is_platform_admin === true;
  const previewRole = useRolePreviewStore((s) => s.previewRole);
  const params = useLocalSearchParams<{ sessionId?: string; title?: string; initialCount?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : Array.isArray(params.sessionId) ? params.sessionId[0] : '';
  const sessionTitle = typeof params.title === 'string' ? params.title : 'Session';
  const [permission, requestPermission] = useCameraPermissions();
  const scanBusyRef = useRef(false);
  const scanGenRef = useRef(0);
  const [scanCooldown, setScanCooldown] = useState(false);
  const [checkInCount, setCheckInCount] = useState(() => parseInitialCount(params.initialCount));
  const [lastName, setLastName] = useState<string | null>(null);
  const [lastScanKind, setLastScanKind] = useState<LastScanKind>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [canUse, setCanUse] = useState(false);

  useEffect(() => {
    if (!user?.id || !currentEvent?.id) {
      setAccessChecked(true);
      setCanUse(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [{ data: member }, { data: ev }] = await Promise.all([
          supabase
            .from('event_members')
            .select('role, roles')
            .eq('event_id', currentEvent.id)
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('events')
            .select(
              'admin_console_tiles, menu_show_session_check_in, platform_menu_show_session_check_in'
            )
            .eq('id', currentEvent.id)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        const row = member as { role?: string; roles?: string[] } | null;
        const role = row?.role ?? 'attendee';
        const roles = Array.isArray(row?.roles) ? row.roles : [];
        const isAdmin =
          role === 'admin' ||
          role === 'super_admin' ||
          roles.includes('admin') ||
          roles.includes('super_admin');
        const evRow = ev as {
          admin_console_tiles?: string[];
          menu_show_session_check_in?: boolean;
          platform_menu_show_session_check_in?: boolean;
        } | null;
        const merged = {
          ...currentEvent,
          admin_console_tiles: evRow?.admin_console_tiles ?? currentEvent.admin_console_tiles,
          menu_show_session_check_in: evRow?.menu_show_session_check_in,
          platform_menu_show_session_check_in: evRow?.platform_menu_show_session_check_in,
        };
        setCanUse(effectiveCanShowSessionCheckIn(merged, isAdmin, isPlatformAdmin, previewRole));
      } catch {
        if (!cancelled) setCanUse(false);
      } finally {
        if (!cancelled) setAccessChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, currentEvent, isPlatformAdmin, previewRole]);

  useEffect(() => {
    if (accessChecked && !canUse) router.replace('/(tabs)/home');
  }, [accessChecked, canUse, router]);

  const refreshCount = useCallback(async () => {
    if (!currentEvent?.id || !sessionId) return;
    const res = await listSessionsForCheckIn(currentEvent.id);
    const row = res.rows?.find((s) => s.id === sessionId);
    if (row) setCheckInCount(row.check_in_count);
  }, [currentEvent?.id, sessionId]);

  useEffect(() => {
    setCheckInCount(parseInitialCount(params.initialCount));
    setLastScanKind(null);
    setLastName(null);
    scanBusyRef.current = false;
    refreshCount();
  }, [sessionId, params.initialCount, refreshCount]);

  useEffect(() => {
    if (accessChecked && canUse) refreshCount();
  }, [accessChecked, canUse, refreshCount]);

  const onBarcode = useCallback(
    async ({ data }: { data: string }) => {
      if (!sessionId || scanCooldown || !canUse || scanBusyRef.current) return;
      const token = parseBadgeTokenFromQrData(data);
      if (!token) return;
      scanBusyRef.current = true;
      const gen = ++scanGenRef.current;
      setScanCooldown(true);
      setLastScanKind(null);
      const res = await recordSessionCheckIn(sessionId, token);
      setTimeout(() => {
        scanBusyRef.current = false;
        setScanCooldown(false);
      }, 1500);
      if (gen !== scanGenRef.current) return;
      if (res.error) {
        setLastScanKind(null);
        const msg =
          res.error === 'feature_disabled'
            ? 'Session attendance is not enabled for this event. Ask your platform admin.'
            : res.error === 'check_in_disabled'
              ? 'This session is not open for room check-in. Choose another session in Session check-in.'
              : res.error === 'forbidden'
                ? 'You do not have permission to check in attendees for this event.'
                : res.error === 'not_found'
                  ? 'Badge not recognized for this event.'
                  : res.error;
        Toast.show({ type: 'error', text1: 'Check-in failed', text2: msg, visibilityTime: 5000 });
        return;
      }
      const duplicate = res.already_checked_in === true;
      const name = res.subject?.full_name?.trim() || 'Attendee';
      const slotLabel = res.session?.title?.trim() || sessionTitle;
      setLastName(name);
      setLastScanKind(duplicate ? 'already_scanned' : 'checked_in');
      if (typeof res.check_in_count === 'number') setCheckInCount(res.check_in_count);
      if (duplicate) {
        Toast.show({
          type: 'info',
          text1: 'Already scanned',
          text2: `${name} was already checked in for “${slotLabel}”.`,
          visibilityTime: 5000,
        });
      } else {
        Toast.show({ type: 'success', text1: 'Checked in', text2: name, visibilityTime: 4000 });
      }
    },
    [sessionId, scanCooldown, canUse, sessionTitle]
  );

  if (!accessChecked) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Session check-in" onBack={() => router.back()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!canUse) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Session check-in" onBack={() => router.back()} />
        <Text style={styles.hint}>Session check-in is not available for this event or your role.</Text>
      </SafeAreaView>
    );
  }

  if (!sessionId) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Scan" onBack={() => router.back()} />
        <Text style={styles.hint}>Missing session. Go back and pick a session.</Text>
      </SafeAreaView>
    );
  }

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileStackScreenHeader variant="back" title="Session check-in" onBack={() => router.back()} />
        <Text style={styles.hint}>Camera access is required to scan badges.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => requestPermission()}>
          <Text style={styles.btnText}>Allow camera</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader variant="back" title="Session check-in" onBack={() => router.back()} />
      <Text style={styles.sessionTitle} numberOfLines={2}>
        {sessionTitle}
      </Text>
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>{checkInCount} checked in</Text>
        {lastName ? <Text style={styles.lastScan}>Last: {lastName}</Text> : null}
      </View>
      {lastScanKind === 'already_scanned' ? (
        <View style={styles.bannerAlready} accessibilityRole="alert">
          <AlertCircle size={22} color={colors.warning} />
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerTitle}>Already scanned</Text>
            <Text style={styles.bannerBody}>
              {lastName ?? 'This attendee'} is already checked in for “{sessionTitle}”. They are only counted once per
              session.
            </Text>
          </View>
        </View>
      ) : null}
      {lastScanKind === 'checked_in' ? (
        <View style={styles.bannerOk} accessibilityRole="text">
          <CheckCircle2 size={22} color={colors.success} />
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerTitleOk}>Checked in</Text>
            <Text style={styles.bannerBodyOk}>{lastName ?? 'Attendee'} added to this session.</Text>
          </View>
        </View>
      ) : null}
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanCooldown ? undefined : onBarcode}
        />
        {scanCooldown ? (
          <View style={styles.overlay}>
            <ActivityIndicator color="#fff" size="large" />
          </View>
        ) : null}
      </View>
      <Text style={[styles.footerHint, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        Scan attendee badge QR. If they were already scanned for this session, the amber box above stays until the next
        scan.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  sessionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, paddingHorizontal: 20, marginBottom: 8 },
  statsBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  statsText: { fontSize: 15, fontWeight: '700', color: colors.primary },
  lastScan: { fontSize: 13, color: colors.textSecondary, flex: 1, textAlign: 'right', marginLeft: 12 },
  bannerAlready: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff7ed',
    borderWidth: 2,
    borderColor: colors.warning,
  },
  bannerOk: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f0fdf4',
    borderWidth: 2,
    borderColor: colors.success,
  },
  bannerTextWrap: { flex: 1 },
  bannerTitle: { fontSize: 16, fontWeight: '800', color: '#b45309', marginBottom: 4 },
  bannerBody: { fontSize: 14, color: colors.text, lineHeight: 20 },
  bannerTitleOk: { fontSize: 16, fontWeight: '800', color: '#15803d', marginBottom: 4 },
  bannerBodyOk: { fontSize: 14, color: colors.text, lineHeight: 20 },
  cameraWrap: { flex: 1, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', minHeight: 280 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerHint: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 24, paddingTop: 12 },
  hint: { padding: 20, color: colors.textSecondary, fontSize: 14 },
  btn: {
    marginHorizontal: 20,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 16 },
});
