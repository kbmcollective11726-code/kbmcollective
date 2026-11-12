import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CalendarDays, Handshake, Network, Users } from 'lucide-react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const GOLD = '#C6A36A';
const RING_GOLD = '#F0DBA9';
const LETTERS = require('../assets/startup-mark-letters.png');

const MARK_W = 230;
const MARK_H = 266;
const SCALE = MARK_W / 485;
const OFFSET_Y = (MARK_H - 560 * SCALE) / 2;
const CX = 242 * SCALE;
const CY = 236 * SCALE + OFFSET_Y;
const OUTER_R = 215.5 * SCALE;
const INNER_R = 205 * SCALE;
const OUTER_W = 6.2 * SCALE;
const INNER_W = 4.2 * SCALE;
const OUTER_C = 2 * Math.PI * OUTER_R;
const INNER_C = 2 * Math.PI * INNER_R;

type IconCmp = typeof CalendarDays;

const CHIPS: { Icon: IconCmp; label: string }[] = [
  { Icon: CalendarDays, label: 'Agenda' },
  { Icon: Handshake, label: 'Meetings' },
  { Icon: Users, label: 'People' },
  { Icon: Network, label: 'Network' },
];

type Props = {
  play: boolean;
  onDone: () => void;
  showSkip?: boolean;
  onSkip?: () => void;
};

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function Chip({
  index,
  progress,
  Icon,
  label,
}: {
  index: number;
  progress: SharedValue<number>;
  Icon: IconCmp;
  label: string;
}) {
  const style = useAnimatedStyle(() => {
    const start = index * 0.14;
    const t = Math.min(1, Math.max(0, (progress.value - start) / 0.5));
    return {
      opacity: t,
      transform: [{ translateY: (1 - t) * 10 }],
    };
  });

  return (
    <Animated.View style={[styles.chip, style]}>
      <Icon color={GOLD} size={20} strokeWidth={1.6} />
      <Text style={styles.chipLabel}>{label}</Text>
    </Animated.View>
  );
}

export default function StartupSplash({ play, onDone, showSkip, onSkip }: Props) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const started = useRef(false);
  const [draw, setDraw] = useState(0);
  const letters = useSharedValue(0);
  const icons = useSharedValue(0);
  const shine = useSharedValue(0);

  useEffect(() => {
    if (!play || started.current) return;
    started.current = true;

    const drawMs = 1100;
    const drawStart = Date.now();
    let frame = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - drawStart) / drawMs);
      setDraw(easeInOut(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    letters.value = withDelay(
      160,
      withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) }),
    );
    icons.value = withDelay(
      1100,
      withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }),
    );
    shine.value = withDelay(
      1450,
      withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
    );

    const timer = setTimeout(() => onDoneRef.current(), 2450);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [icons, letters, play, shine]);

  const lettersStyle = useAnimatedStyle(() => ({
    opacity: letters.value,
    transform: [{ scale: 0.94 + letters.value * 0.06 }],
  }));

  const shineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shine.value, [0, 0.12, 0.82, 1], [0, 0.9, 0.9, 0]),
    transform: [{ translateX: -150 + shine.value * 400 }, { rotate: '18deg' }],
  }));

  return (
    <View style={styles.screen}>
      <View style={styles.stage}>
        <View style={styles.markBox}>
          <Svg width={MARK_W} height={MARK_H} style={StyleSheet.absoluteFill}>
            <Circle
              cx={CX}
              cy={CY}
              r={OUTER_R}
              stroke={RING_GOLD}
              strokeWidth={OUTER_W}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${OUTER_C} ${OUTER_C}`}
              strokeDashoffset={OUTER_C * (1 - draw)}
              transform={`rotate(-90 ${CX} ${CY})`}
            />
            <Circle
              cx={CX}
              cy={CY}
              r={INNER_R}
              stroke={RING_GOLD}
              strokeWidth={INNER_W}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${INNER_C} ${INNER_C}`}
              strokeDashoffset={INNER_C * (1 - draw)}
              transform={`rotate(-90 ${CX} ${CY})`}
            />
          </Svg>
          <Animated.View style={[styles.layer, lettersStyle]} pointerEvents="none">
            <Image source={LETTERS} style={styles.mark} resizeMode="contain" />
          </Animated.View>
          <Animated.View style={[styles.shine, shineStyle]} pointerEvents="none">
            <LinearGradient
              colors={[
                'rgba(255,236,190,0)',
                'rgba(255,244,220,0.15)',
                'rgba(255,250,235,0.95)',
                'rgba(255,244,220,0.15)',
                'rgba(255,236,190,0)',
              ]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
        <View style={styles.row}>
          {CHIPS.map((chip, index) => (
            <Chip
              key={chip.label}
              index={index}
              progress={icons}
              Icon={chip.Icon}
              label={chip.label}
            />
          ))}
        </View>
      </View>
      {showSkip ? (
        <TouchableOpacity style={styles.skip} onPress={onSkip} activeOpacity={0.8}>
          <Text style={styles.skipText}>Stuck? Tap to open login</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    alignItems: 'center',
  },
  markBox: {
    width: MARK_W,
    height: MARK_H,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: MARK_W,
    height: MARK_H,
  },
  shine: {
    position: 'absolute',
    top: -48,
    width: 56,
    height: MARK_H + 96,
  },
  row: {
    marginTop: 22,
    width: 320,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  chip: {
    width: 74,
    alignItems: 'center',
  },
  chipLabel: {
    marginTop: 6,
    fontSize: 11,
    letterSpacing: 0.3,
    color: GOLD,
  },
  skip: {
    position: 'absolute',
    bottom: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 14,
    color: GOLD,
  },
});
