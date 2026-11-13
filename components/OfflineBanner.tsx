import { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { WifiOff } from 'lucide-react-native';
import { colors } from '../constants/colors';
import { supabaseUrl, supabaseAnonKey, isSupabaseConfigured } from '../lib/supabase';
import { useConnectivityStore } from '../stores/connectivityStore';

/** Matches PostFAB: floating tab bar capsule + pad, then FAB gap. */
const TAB_BAR_HEIGHT = 66;
const ABOVE_TAB_BAR_GAP = 12;
const PILL_HEIGHT = 40;
/** PostFAB is 56 wide at right: 20; keep the pill clear of it. */
const FAB_CLEARANCE = 20 + 56 + 12;
/** Screens with a message composer right above the tab bar, where the pill would cover the input. */
const COMPOSER_ROUTE = /\/chat\/|\/feed\/comment\/|\/groups\/(?!new$)[^/]+$/;

/**
 * Slim strip above the tab bar when Supabase/API looks unreachable, kept clear of the
 * header (menu, bell, profile) and the camera button.
 * Successful pings clear it; live screens also call reportSuccess on good fetches.
 */
export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const isOffline = useConnectivityStore((s) => s.isOffline);
  const showingCachedData = useConnectivityStore((s) => s.showingCachedData);
  const reportSuccess = useConnectivityStore((s) => s.reportSuccess);
  const reportFailure = useConnectivityStore((s) => s.reportFailure);
  const probingRef = useRef(false);

  const probe = useCallback(async () => {
    if (probingRef.current) return;
    probingRef.current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      // Hit the REST root — does not depend on events RLS / row visibility.
      if (!isSupabaseConfigured) {
        reportFailure(new Error('network request failed'));
        return;
      }
      const res = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
      });
      if (!res.ok && res.status >= 500) {
        throw new Error(`service unavailable ${res.status}`);
      }
      reportSuccess();
    } catch (err) {
      reportFailure(err);
    } finally {
      clearTimeout(timeout);
      probingRef.current = false;
    }
  }, [reportFailure, reportSuccess]);

  useEffect(() => {
    if (!isOffline && !showingCachedData) return;
    void probe();
    const id = setInterval(() => {
      void probe();
    }, 20000);
    return () => clearInterval(id);
  }, [isOffline, showingCachedData, probe]);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active' && (isOffline || showingCachedData)) {
        void probe();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [isOffline, showingCachedData, probe]);

  if (!isOffline && !showingCachedData) return null;
  if (pathname && COMPOSER_ROUTE.test(pathname)) return null;

  const label = isOffline ? 'Check Wi-Fi or cellular data' : 'Showing saved info';
  const fabRowBottom = Math.max(insets.bottom + TAB_BAR_HEIGHT + ABOVE_TAB_BAR_GAP, 96);

  return (
    <View
      style={[styles.container, { bottom: fabRowBottom + (56 - PILL_HEIGHT) / 2 }]}
      pointerEvents="box-none"
      accessibilityRole="alert"
      accessibilityLabel={isOffline ? 'No connection. Check Wi-Fi or cellular data.' : 'Showing info saved on this phone.'}
    >
      <View style={styles.inner}>
        <WifiOff size={16} color="#92400e" strokeWidth={2.5} />
        <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          {label}
        </Text>
        <TouchableOpacity
          onPress={() => void probe()}
          style={styles.retryBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retry connection"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: FAB_CLEARANCE,
    alignItems: 'flex-start',
    zIndex: 100001,
    ...Platform.select({
      android: { elevation: 26 },
      default: {},
    }),
  },
  inner: {
    height: PILL_HEIGHT,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: PILL_HEIGHT / 2,
    paddingLeft: 12,
    paddingRight: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  label: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#92400e',
  },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f59e0b',
  },
  retryText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
});
