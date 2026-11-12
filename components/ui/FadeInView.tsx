import { type ReactNode, useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Stagger index for list rows (0, 1, 2…). */
  index?: number;
  durationMs?: number;
};

/** Soft fade + slight rise for list/card entry. */
export default function FadeInView({
  children,
  style,
  index = 0,
  durationMs = 380,
}: Props) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(10);

  useEffect(() => {
    const delay = Math.min(index, 12) * 40;
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: durationMs, easing: Easing.out(Easing.cubic) }),
    );
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: durationMs, easing: Easing.out(Easing.cubic) }),
    );
  }, [durationMs, index, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
