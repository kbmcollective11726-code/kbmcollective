import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Eye, X, Check } from 'lucide-react-native';
import { colors } from '../constants/colors';
import { useAuthStore } from '../stores/authStore';
import { useRolePreviewStore } from '../stores/rolePreviewStore';
import {
  isPreviewActive,
  previewRoleLabel,
  ROLE_PREVIEW_OPTIONS,
  type RolePreviewKind,
} from '../lib/rolePreview';

type RolePreviewPickerProps = {
  visible: boolean;
  onClose: () => void;
};

export function RolePreviewPicker({ visible, onClose }: RolePreviewPickerProps) {
  const insets = useSafeAreaInsets();
  const previewRole = useRolePreviewStore((s) => s.previewRole);
  const setPreviewRole = useRolePreviewStore((s) => s.setPreviewRole);

  const choose = async (role: RolePreviewKind) => {
    await setPreviewRole(role);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 16) }]} onPress={() => {}}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Preview as role</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <X size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.sheetHint}>
            UI testing only — your account permissions on the server do not change. Turn off preview to use platform
            admin tools again.
          </Text>
          <ScrollView style={styles.optionList} keyboardShouldPersistTaps="handled">
            {ROLE_PREVIEW_OPTIONS.map((opt) => {
              const selected = previewRole === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.optionRow, selected && styles.optionRowSelected]}
                  onPress={() => choose(opt.id)}
                  activeOpacity={0.75}
                >
                  <View style={styles.optionTextCol}>
                    <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{opt.label}</Text>
                    <Text style={styles.optionHint}>{opt.hint}</Text>
                  </View>
                  {selected ? <Check size={20} color={colors.primary} strokeWidth={2.5} /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Sticky banner while platform admin previews another role. */
export default function RolePreviewBanner() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const previewRole = useRolePreviewStore((s) => s.previewRole);
  const hydrated = useRolePreviewStore((s) => s.hydrated);
  const hydrate = useRolePreviewStore((s) => s.hydrate);
  const resetPreview = useRolePreviewStore((s) => s.resetPreview);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isPlatformAdmin = user?.is_platform_admin === true;

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  if (!isPlatformAdmin || !hydrated || !isPreviewActive(previewRole)) {
    return null;
  }

  return (
    <>
      <View style={[styles.banner, { paddingTop: Math.max(6, insets.top > 0 ? 4 : 6) }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.bannerInner}
          onPress={() => setPickerOpen(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Previewing as ${previewRoleLabel(previewRole)}. Tap to change.`}
        >
          <Eye size={16} color="#92400e" strokeWidth={2.5} />
          <Text style={styles.bannerText} numberOfLines={2}>
            Previewing as <Text style={styles.bannerStrong}>{previewRoleLabel(previewRole)}</Text> — tap to change
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.exitBtn}
          onPress={() => resetPreview()}
          hitSlop={8}
          accessibilityLabel="Exit role preview"
        >
          <Text style={styles.exitBtnText}>Exit</Text>
        </TouchableOpacity>
      </View>
      <RolePreviewPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}

export function RolePreviewMenuButton({ onPress }: { onPress: () => void }) {
  const user = useAuthStore((s) => s.user);
  const previewRole = useRolePreviewStore((s) => s.previewRole);
  if (user?.is_platform_admin !== true) return null;

  const active = isPreviewActive(previewRole);
  return (
    <TouchableOpacity style={styles.menuBtn} onPress={onPress} activeOpacity={0.75}>
      <Eye size={20} color={active ? colors.primary : colors.textSecondary} />
      <View style={styles.menuBtnTextCol}>
        <Text style={[styles.menuBtnLabel, active && styles.menuBtnLabelActive]}>
          {active ? `Preview: ${previewRoleLabel(previewRole)}` : 'Preview as role'}
        </Text>
        <Text style={styles.menuBtnHint}>Test attendee, speaker, vendor, or event admin UI</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef3c7',
    borderBottomWidth: 1,
    borderBottomColor: '#fcd34d',
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 8,
  },
  bannerInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
  },
  bannerStrong: {
    fontWeight: '700',
  },
  exitBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#fde68a',
  },
  exitBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    maxHeight: '82%',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  sheetHint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 14,
  },
  optionList: {
    flexGrow: 0,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    gap: 12,
  },
  optionRowSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}12`,
  },
  optionTextCol: {
    flex: 1,
    minWidth: 0,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  optionLabelSelected: {
    color: colors.primary,
  },
  optionHint: {
    marginTop: 3,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  menuBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuBtnTextCol: {
    flex: 1,
    minWidth: 0,
  },
  menuBtnLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  menuBtnLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  menuBtnHint: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
});
