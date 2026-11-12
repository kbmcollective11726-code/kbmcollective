import { Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../constants/colors';

type Props = {
  children: React.ReactNode;
  style?: object;
};

/**
 * Soft full-screen atmosphere: whisper cool gradient behind content.
 * Screens/cards keep solid surfaces; this only adds elegance at the edges.
 * Kept neutral (not theme-tinted) so event hex only drives chrome/icons.
 */
export default function ScreenAtmosphere({ children, style }: Props) {
  return (
    <View style={[styles.root, style]}>
      <LinearGradient
        colors={[colors.atmosphereTop, colors.atmosphereMid, colors.atmosphereBottom]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.atmosphereMid,
    ...Platform.select({
      android: { overflow: 'hidden' as const },
      default: {},
    }),
  },
});
