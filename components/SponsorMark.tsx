import type { StyleProp, ImageStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { colors } from '../constants/colors';

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
 */
export function SponsorMark({ uri, style, contentFit = 'contain' }: Props) {
  const u = uri.trim();
  if (!u) return null;
  return (
    <ExpoImage
      source={{ uri: u }}
      style={[style, { backgroundColor: colors.background }]}
      contentFit={contentFit}
      contentPosition="center"
      cachePolicy="memory-disk"
      transition={0}
    />
  );
}
