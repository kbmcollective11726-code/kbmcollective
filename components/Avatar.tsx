import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../constants/colors';
import { themeColorWithAlpha, useEventThemeColor } from '../lib/eventTheme';
import PortraitAvatarPhoto from './PortraitAvatarPhoto';

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
}

export default function Avatar({ uri, name, size = 40 }: AvatarProps) {
  const themeColor = useEventThemeColor();
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
        uri ? styles.ringWithPhoto : { backgroundColor: themeColorWithAlpha(themeColor, '26') },
      ]}
    >
      {uri ? (
        <PortraitAvatarPhoto uri={uri} />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.4, color: themeColor }]}>{initials}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  ringWithPhoto: {
    backgroundColor: colors.surfaceHover,
  },
  initials: {
    fontWeight: '600',
  },
});
