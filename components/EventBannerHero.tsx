import { useEffect, useState } from 'react';
import { ImageBackground, Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  EVENT_BANNER_LETTERBOX_BG,
  INFO_BANNER_DISPLAY_ASPECT,
  infoBannerHeightForWidth,
} from '../lib/eventBanner';
import { theme } from '../constants/theme';

type Props = {
  uri: string;
};

const ASPECT_MATCH_TOLERANCE = 0.04;

/**
 * Fixed 16:10 hero (~⅓ screen height). Matches May / reference layout.
 * 16:10 artwork → cover (fills the slot). Wider/taller files → contain (no crop).
 */
export default function EventBannerHero({ uri }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const height = infoBannerHeightForWidth(windowWidth);
  const [resizeMode, setResizeMode] = useState<'cover' | 'contain'>('cover');

  useEffect(() => {
    let cancelled = false;
    setResizeMode('cover');

    Image.getSize(
      uri,
      (w, h) => {
        if (cancelled || w <= 0 || h <= 0) return;
        const aspect = w / h;
        const delta = Math.abs(aspect - INFO_BANNER_DISPLAY_ASPECT) / INFO_BANNER_DISPLAY_ASPECT;
        setResizeMode(delta <= ASPECT_MATCH_TOLERANCE ? 'cover' : 'contain');
      },
      () => {
        if (!cancelled) setResizeMode('cover');
      },
    );

    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <View
      style={[
        styles.wrap,
        { height, backgroundColor: EVENT_BANNER_LETTERBOX_BG },
      ]}
    >
      <ImageBackground
        source={{ uri }}
        style={styles.image}
        imageStyle={styles.imageInner}
        resizeMode={resizeMode}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignSelf: 'stretch',
    overflow: 'hidden',
    marginBottom: theme.spacing.lg,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageInner: {},
});
