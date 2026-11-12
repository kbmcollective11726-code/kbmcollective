import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../../constants/colors';

type Props = {
  title: string;
  style?: StyleProp<ViewStyle>;
};

/** Stronger section label with breathing room. */
export default function SectionHeader({ title, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.15,
  },
});
