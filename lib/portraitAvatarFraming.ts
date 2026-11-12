import type { ImageContentPosition } from 'expo-image';
import type { ImageStyle } from 'react-native';

/** Bias crop toward the upper center — typical event headshots keep the face here. */
export const PORTRAIT_AVATAR_CONTENT_POSITION: ImageContentPosition = {
  top: '14%',
  left: '50%',
};

/** Hero blur: anchor from the top so foreheads are not clipped behind the header. */
export const PORTRAIT_HERO_BACKDROP_CONTENT_POSITION: ImageContentPosition = 'top';

/** RN Image fallback when expo-image contentPosition is unavailable. */
export const portraitAvatarImageStyle: ImageStyle = {
  position: 'absolute',
  top: 0,
  left: '-4%',
  width: '108%',
  height: '108%',
};

/** Full-bleed hero backdrop — top-aligned, slightly zoomed out vs the circle avatar. */
export const portraitHeroBackdropImageStyle: ImageStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
};
