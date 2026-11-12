import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../../constants/colors';
import { useEventThemeColor } from '../../lib/eventTheme';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Hide accent (e.g. nested cards). */
  showAccent?: boolean;
};

/** White card with a thin theme-colored left edge. */
export default function AccentCard({ children, style, showAccent = true }: Props) {
  const themeColor = useEventThemeColor();
  return (
    <View
      style={[
        styles.card,
        showAccent && { borderLeftColor: themeColor, borderLeftWidth: 3 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
});
