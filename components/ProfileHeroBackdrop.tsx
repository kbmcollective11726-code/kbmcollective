import { Platform, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { PORTRAIT_HERO_BACKDROP_CONTENT_POSITION } from '../lib/portraitAvatarFraming';
import { colors } from '../constants/colors';

type Props = {
  avatarUrl: string;
};

const HERO_BLUR = Platform.select({
  ios: 72,
  android: 18,
  default: 42,
})!;

const FADE_MID = Platform.select({
  ios: 'rgba(255,255,255,0.30)',
  android: 'rgba(255,255,255,0.14)',
  default: 'rgba(255,255,255,0.22)',
})!;

const HERO_GRADIENT_COLORS = ['rgba(255,255,255,0)', FADE_MID, colors.background] as const;

export default function ProfileHeroBackdrop({ avatarUrl }: Props) {
  return (
    <>
      <ExpoImage
        source={{ uri: avatarUrl }}
        style={styles.bgImage}
        contentFit="cover"
        contentPosition={PORTRAIT_HERO_BACKDROP_CONTENT_POSITION}
        blurRadius={HERO_BLUR}
        cachePolicy="memory-disk"
        transition={200}
      />
      <View style={styles.toneOverlay} pointerEvents="none" />
      <LinearGradient
        colors={HERO_GRADIENT_COLORS}
        locations={[0, 0.78, 1]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
    </>
  );
}

const styles = StyleSheet.create({
  bgImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    height: '110%',
  },
  toneOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(51, 65, 85, 0.10)',
  },
});
