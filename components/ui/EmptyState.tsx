import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/colors';
import { useEventThemeColor } from '../../lib/eventTheme';
import PressScale from './PressScale';

type Props = {
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
};

/** Friendly empty state with optional themed outline CTA. */
export default function EmptyState({ title, subtitle, ctaLabel, onCtaPress }: Props) {
  const themeColor = useEventThemeColor();
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {ctaLabel && onCtaPress ? (
        <PressScale onPress={onCtaPress} style={[styles.cta, { borderColor: themeColor }]}>
          <Text style={[styles.ctaText, { color: themeColor }]}>{ctaLabel}</Text>
        </PressScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 40,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  cta: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1.5,
    backgroundColor: colors.card,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
