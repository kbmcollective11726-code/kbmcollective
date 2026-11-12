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
import { WifiOff } from 'lucide-react-native';
import { colors } from '../constants/colors';
import { supabaseUrl, supabaseAnonKey, isSupabaseConfigured } from '../lib/supabase';
import { useConnectivityStore } from '../stores/connectivityStore';

/**
 * Sticky top banner when Supabase/API looks unreachable.
 * Successful pings clear it; live screens also call reportSuccess on good fetches.
 */
export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
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

  const title = isOffline ? 'Connection issue' : 'Saved info';
  const body = isOffline
    ? 'Check Wi-Fi or cellular data.'
    : 'Showing the last info saved on this phone.';

  return (
    <View
      style={[styles.container, { top: Math.max(8, insets.top + 4) }]}
      pointerEvents="box-none"
      accessibilityRole="alert"
    >
      <View style={styles.inner}>
        <View style={styles.iconWrap}>
          <WifiOff size={18} color="#92400e" strokeWidth={2.5} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body} numberOfLines={2}>
            {body}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => void probe()}
          style={styles.retryBtn}
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
    left: 12,
    right: 12,
    zIndex: 100001,
    ...Platform.select({
      android: { elevation: 26 },
      default: {},
    }),
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fde68a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400e',
  },
  body: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: '#78350f',
  },
  retryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f59e0b',
  },
  retryText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
});
