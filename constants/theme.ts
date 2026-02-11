/**
 * Guidebook-style theme constants: one accent, white/airy, card-based.
 * Use with colors from constants/colors.ts.
 */
import { Platform } from 'react-native';
import { colors } from './colors';

export const theme = {
  // Card: white background, rounded corners, light shadow
  cardRadius: 12,
  cardRadiusLarge: 16,
  cardPadding: 16,
  cardPaddingLarge: 20,
  cardMarginBottom: 16,
  cardBackground: colors.card,
  cardShadow: Platform.select({
    ios: {
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
    },
    android: {
      elevation: 2,
    },
    default: {},
  }) as object,

  // Section: same as card for consistency
  sectionRadius: 12,
  sectionPadding: 16,
  sectionMarginBottom: 16,

  // Spacing (8, 12, 16, 20, 24, 32)
  spacing: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
  },

  // Hero / event banner: single-accent gradient (primary → primaryDark)
  heroRadius: 20,
  heroPaddingVertical: 28,
  heroPaddingHorizontal: 24,
  heroTitleSize: 24,
  heroSubtitleSize: 15,
  heroStatGap: 12,
  heroStatPadding: 14,
  heroStatRadius: 12,
} as const;
