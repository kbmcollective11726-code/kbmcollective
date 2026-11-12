import { StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import {
  PORTRAIT_AVATAR_CONTENT_POSITION,
  portraitAvatarImageStyle,
} from '../lib/portraitAvatarFraming';

type Props = {
  uri: string;
  style?: object;
  transition?: number;
};

/** Circular portrait photo with consistent face framing (top-centered crop). */
export default function PortraitAvatarPhoto({ uri, style, transition = 120 }: Props) {
  return (
    <ExpoImage
      source={{ uri }}
      style={[styles.photo, portraitAvatarImageStyle, style]}
      contentFit="cover"
      contentPosition={PORTRAIT_AVATAR_CONTENT_POSITION}
      cachePolicy="memory-disk"
      transition={transition}
    />
  );
}

const styles = StyleSheet.create({
  photo: {
    width: '100%',
    height: '100%',
  },
});
