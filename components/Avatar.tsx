import { View, Text, Image, StyleSheet } from 'react-native';
import { colors } from '../constants/colors';

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
    <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? (
        <Image source={{ uri }} style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]} />
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
  image: {
    resizeMode: 'cover',
  },
  initials: {
    fontWeight: '600',
    color: colors.primary,
  },
});
