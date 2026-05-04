import { Platform } from 'react-native';
import { colors } from './colors';

/** iOS navigation bar can still draw a shadow; pair with headerShadowVisible: false. */
const iosFlatBarNoShadow = {
  shadowColor: 'transparent' as const,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,
};

/**
 * One consistent top bar: native stack defaults differ by platform (Android elevation,
 * iOS shadow). Tabs + nested stacks should use this so headers don’t look “raised” on
 * some screens and flat on others (often noticeable on iPhone when switching routes).
 */
export const flatNativeStackHeaderStyle = {
  backgroundColor: colors.background,
  borderBottomWidth: 1,
  borderBottomColor: colors.borderLight,
  ...(Platform.OS === 'android' ? { elevation: 0 } : iosFlatBarNoShadow),
};
