import { TouchableOpacity, StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera } from 'lucide-react-native';
import { colors } from '../constants/colors';
import { useEventThemeColor } from '../lib/eventTheme';

/** Capsule (~58) + top pad (8); keep FAB above floating tab bar. */
const TAB_BAR_HEIGHT = 66;
const FAB_PADDING = 12;

export default function PostFAB() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const themeColor = useEventThemeColor();
  const bottomOffset = Math.max(insets.bottom + TAB_BAR_HEIGHT + FAB_PADDING, 96);

  const openPost = () => {
    const from =
      pathname && pathname !== '/' && !pathname.includes('/post')
        ? pathname
        : '/(tabs)/feed';
    router.push(`/post?from=${encodeURIComponent(from)}` as never);
  };

  return (
    <View style={[styles.wrapper, { bottom: bottomOffset }]} pointerEvents="box-none">
      <TouchableOpacity
        style={[
          styles.fab,
          {
            backgroundColor: colors.card,
            borderColor: themeColor,
          },
        ]}
        onPress={openPost}
        activeOpacity={0.8}
      >
        <Camera size={24} color={themeColor} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    right: 20,
    left: 0,
    alignItems: 'flex-end',
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    backgroundColor: colors.card,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 4,
  },
});
