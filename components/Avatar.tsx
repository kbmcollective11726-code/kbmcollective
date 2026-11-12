import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../constants/colors';
import PortraitAvatarPhoto from './PortraitAvatarPhoto';

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
}

export default function Avatar({ uri, name, size = 40 }: AvatarProps) {
  const initials = name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() ?? '?';

  return (
    <View
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2 },
        uri ? styles.ringWithPhoto : null,
      ]}
    >
      {uri ? (
        <PortraitAvatarPhoto uri={uri} />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    backgroundColor: colors.primaryFaded,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  ringWithPhoto: {
    backgroundColor: colors.surfaceHover,
  },
  initials: {
    fontWeight: '600',
    color: colors.primary,
  },
});
