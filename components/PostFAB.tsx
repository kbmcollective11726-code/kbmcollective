import { TouchableOpacity, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera } from 'lucide-react-native';
import { colors } from '../constants/colors';

const TAB_BAR_HEIGHT = 56;
const FAB_PADDING = 16;

export default function PostFAB() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomOffset = Math.max(insets.bottom + TAB_BAR_HEIGHT + FAB_PADDING, 88);

  return (
    <View style={[styles.wrapper, { bottom: bottomOffset }]} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/post')}
        activeOpacity={0.8}
      >
        <Camera size={24} color="#fff" />
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
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
