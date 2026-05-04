import type { ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { colors } from '../constants/colors';
import HamburgerMenu from './HamburgerMenu';

type Props =
  | { variant: 'hamburger'; title: string }
  | { variant: 'back'; title: string; onBack: () => void; right?: ReactNode };

/**
 * Flat top bar for profile-stack screens when the native stack header is hidden.
 * Avoids iOS elevated / rounded bar-button backgrounds around hamburger and back controls.
 */
export default function ProfileStackScreenHeader(props: Props) {
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {props.variant === 'hamburger' ? (
          <HamburgerMenu />
        ) : (
          <TouchableOpacity
            onPress={props.onBack}
            style={styles.backHit}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.85}
          >
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {props.title}
      </Text>
      <View style={[styles.side, styles.sideRight]}>
        {props.variant === 'back' ? props.right ?? null : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    paddingHorizontal: 4,
    minHeight: 48,
  },
  side: {
    width: 108,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideRight: {
    justifyContent: 'flex-end',
  },
  backHit: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
});
