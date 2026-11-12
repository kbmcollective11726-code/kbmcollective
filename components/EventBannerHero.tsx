import { useEffect, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import {
  EVENT_BANNER_LETTERBOX_BG,
  infoBannerHeightForWidth,
} from '../lib/eventBanner';
import { theme } from '../constants/theme';

type Props = {
  uri: string;
};

/**
 * Fixed 16:10 hero (~⅓ screen height), full-bleed `cover` (previous Info look).
 * Android remounts on width change so rotate does not blank the image; no fade
 * transition so cache hits stay solid (avoids navy flash).
 */
export default function EventBannerHero({ uri }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const height = infoBannerHeightForWidth(windowWidth);
  const [retryKey, setRetryKey] = useState(0);
  const layoutKey = Platform.OS === 'android' ? Math.round(windowWidth) : 0;

  useEffect(() => {
    void Image.prefetch(uri, 'memory-disk');
  }, [uri]);

  return (
    <View
      style={[
        styles.wrap,
        { height, backgroundColor: EVENT_BANNER_LETTERBOX_BG },
      ]}
    >
      <Image
        key={`${uri}:${layoutKey}:${retryKey}`}
        recyclingKey={uri}
        source={{ uri }}
        style={styles.image}
        contentFit="cover"
        cachePolicy="memory-disk"
        priority="high"
        transition={0}
        onError={() => {
          if (retryKey < 1) {
            setTimeout(() => setRetryKey((k) => k + 1), 600);
          }
        }}
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
});
