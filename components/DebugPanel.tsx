import { useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Share,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Share2, Trash2 } from 'lucide-react-native';
import { getDebugLog, getDebugLogWithPersisted, clearDebugLog } from '../lib/debugLog';
import { testSupabaseConnection } from '../lib/supabase';
import { colors } from '../constants/colors';

/** Only use in __DEV__. Renders a floating "Debug" button and a modal with the log; Share to copy log for support. */
export default function DebugPanel() {
  const [visible, setVisible] = useState(false);
  const [logSnapshot, setLogSnapshot] = useState('');
  const [loading, setLoading] = useState(false);
  const [connectionTest, setConnectionTest] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const insets = useSafeAreaInsets();

  if (!__DEV__) return null;

  const open = useCallback(async () => {
    setVisible(true);
    setLoading(true);
    try {
      const log = await getDebugLogWithPersisted();
      setLogSnapshot(log);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleShare = async () => {
    setLoading(true);
    const message = await getDebugLogWithPersisted();
    setLogSnapshot(message);
    try {
      await Share.share({
        message,
        title: 'CollectiveLive debug log',
      });
    } catch (_) {}
    setLoading(false);
  };

  const handleClear = () => {
    clearDebugLog();
    setLogSnapshot('(cleared — new errors will appear when they happen)');
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionTest(null);
    try {
      const result = await testSupabaseConnection();
      setConnectionTest(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
    } finally {
      setTestingConnection(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        onPress={open}
        style={[styles.fab, { bottom: 100, right: 16 }]}
        activeOpacity={0.8}
      >
        <Text style={styles.fabLabel}>Debug</Text>
      </TouchableOpacity>
      <Modal visible={visible} animationType="slide" transparent>
        <View style={[styles.modalOverlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Debug log</Text>
              <Pressable onPress={() => setVisible(false)} hitSlop={12} style={styles.closeBtn}>
                <X size={24} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.hint}>When something fails, open this and tap Share to copy the log. Tap "Test connection" to see if this device can reach Supabase.</Text>
            <View style={styles.connectionSection}>
              <TouchableOpacity
                onPress={handleTestConnection}
                disabled={testingConnection}
                style={[styles.btn, styles.btnSecondary, { alignSelf: 'flex-start', marginBottom: 8 }]}
              >
                {testingConnection ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : null}
                <Text style={styles.btnSecondaryText}>{testingConnection ? 'Testing…' : 'Test connection'}</Text>
              </TouchableOpacity>
              {connectionTest ? (
                <Text style={[styles.logText, connectionTest.startsWith('✓') ? styles.connectionOk : styles.connectionFail]} selectable>
                  {connectionTest}
                </Text>
              ) : null}
            </View>
            {loading && !logSnapshot ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.loadingText}>Loading log…</Text>
              </View>
            ) : null}
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              <Text style={styles.logText} selectable>
                {logSnapshot || '(empty)'}
              </Text>
            </ScrollView>
            <View style={styles.actions}>
              <TouchableOpacity onPress={handleShare} style={[styles.btn, styles.btnPrimary]}>
                <Share2 size={18} color="#fff" />
                <Text style={styles.btnPrimaryText}>Share / Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClear} style={[styles.btn, styles.btnSecondary]}>
                <Trash2 size={18} color={colors.text} />
                <Text style={styles.btnSecondaryText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setVisible(false)} style={[styles.btn, styles.btnSecondary]}>
                <Text style={styles.btnSecondaryText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    zIndex: 999,
  },
  fabLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.background,
  },
  scroll: {
    maxHeight: 280,
  },
  scrollContent: {
    padding: 16,
  },
  logText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  btnSecondary: {
    backgroundColor: colors.background,
  },
  btnSecondaryText: {
    color: colors.text,
  },
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
  },
  loadingText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  connectionSection: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  connectionOk: {
    color: '#15803d',
    marginTop: 4,
  },
  connectionFail: {
    color: '#b91c1c',
    marginTop: 4,
  },
});
