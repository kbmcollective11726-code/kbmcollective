import type { StyleProp, ImageStyle } from 'react-native';
import { Platform, useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

export type SponsorMarkContentFit = 'cover' | 'contain';

type Props = {
  uri: string;
  style: StyleProp<ImageStyle>;
  /**
   * Default `contain`: full logo visible (Feed / Schedule / Info / hamburger / live wall parity).
   * Pass `cover` only when you intentionally want the image to fill the frame and allow cropping.
   */
  contentFit?: SponsorMarkContentFit;
};

/**
 * Event sponsor logos: use `expo-image` (Glide / SDWebImage) instead of RN `Image` so Android
 * does not paint black letterboxing under `contain` the way RN `Image` sometimes does.
 * Remount on Android width changes so rotate landscape→portrait does not blank the logo.
 */
export function SponsorMark({ uri, style, contentFit = 'contain' }: Props) {
  const { width } = useWindowDimensions();
  const u = uri.trim();
  if (!u) return null;
  const layoutKey = Platform.OS === 'android' ? Math.round(width) : 0;
  return (
    <ExpoImage
      key={`${u}:${layoutKey}`}
      recyclingKey={u}
      source={{ uri: u }}
      style={[style, { backgroundColor: 'transparent' }]}
      contentFit={contentFit}
      contentPosition="center"
      cachePolicy="memory-disk"
      transition={0}
    />
  );
}
