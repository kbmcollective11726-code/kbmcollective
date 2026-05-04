import { TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { router as expoRouter, useGlobalSearchParams, useLocalSearchParams, useRouter } from 'expo-router';
import { colors } from '../constants/colors';

type AppRouter = ReturnType<typeof useRouter>;

function isSafeAppPath(path: string): boolean {
  const base = path.trim().split('?')[0] ?? '';
  return base.startsWith('/(tabs)/') || base.startsWith('/(auth)/');
}

function decodeFromParam(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

export function navigateSolutionBack(router: AppRouter, fromParam: string | string[] | undefined) {
  const raw =
    fromParam == null ? '' : typeof fromParam === 'string' ? fromParam : Array.isArray(fromParam) ? fromParam[0] ?? '' : '';
  const dest = raw ? decodeFromParam(raw).trim() : '';
  const nav = expoRouter ?? router;
  if (dest && isSafeAppPath(dest)) {
    try {
      nav.replace(dest as any);
    } catch {
      nav.replace('/(tabs)/solution-providers' as any);
    }
    return;
  }
  nav.replace('/(tabs)/solution-providers' as any);
}

type SolutionNavBackProps = {
  /** Pass from the parent screen — `useLocalSearchParams` in the header often does not see child route params. */
  fromParam?: string | string[];
};

/**
 * Header back for Solution Provider detail. Pass `fromParam` from the screen that owns `?from=`.
 * (HamburgerMenu / list → detail set `from`.)
 */
function pickFromValue(
  fromParam: string | string[] | undefined,
  global: { from?: string | string[] },
  local: { from?: string | string[] }
): string | string[] | undefined {
  if (typeof fromParam === 'string' && fromParam.trim()) return fromParam;
  if (Array.isArray(fromParam) && fromParam[0]) return fromParam;
  const g = global.from;
  if (typeof g === 'string' && g.trim()) return g;
  if (Array.isArray(g) && g[0]) return g;
  const l = local.from;
  if (typeof l === 'string' && l.trim()) return l;
  if (Array.isArray(l) && l[0]) return l;
  return undefined;
}

export default function SolutionNavBack({ fromParam }: SolutionNavBackProps) {
  const router = useRouter();
  const globalParams = useGlobalSearchParams<{ from?: string | string[] }>();
  const localParams = useLocalSearchParams<{ from?: string | string[] }>();
  const merged = pickFromValue(fromParam, globalParams, localParams);

  const onPress = () => {
    navigateSolutionBack(router, merged);
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.hit}
      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <ChevronLeft size={26} color={colors.text} strokeWidth={2} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  hit: {
    marginLeft: 4,
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
});
