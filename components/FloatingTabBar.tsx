import { Platform, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { useEventStore } from '../stores/eventStore';
import { resolveEventThemeColor } from '../lib/eventTheme';
import { navigateToFeedRoot } from '../lib/navigateToFeedRoot';
import { navigateToTabRoot } from '../lib/navigateToTabRoot';
import PressScale from './ui/PressScale';

/** Capsule height helper for FAB / overlays above the floating tab bar. */
export const FLOATING_TAB_CHROME = 72;

function isFeedDetailPath(pathname: string | undefined): boolean {
  if (!pathname) return false;
  return pathname.includes('/feed/user/') || pathname.includes('/feed/comment/');
}

/** Nested profile / expo routes — no bottom tab should look "selected". */
function isNestedAwayFromMainTabs(pathname: string | undefined): boolean {
  if (!pathname) return false;
  if (isFeedDetailPath(pathname)) return true;
  if (pathname.includes('/profile/')) return true;
  if (pathname.includes('/expo/') && !pathname.endsWith('/expo') && !pathname.includes('/expo?')) return true;
  if (pathname.includes('/solution-provider')) return true;
  return false;
}

function isTabVisible(options: BottomTabBarProps['descriptors'][string]['options']): boolean {
  const href = (options as { href?: string | null }).href;
  if (href === null) return false;
  const itemStyle = options.tabBarItemStyle as { display?: string } | undefined;
  if (itemStyle?.display === 'none') return false;
  return true;
}

/**
 * Floating capsule tab bar — inset rounded control over the page atmosphere.
 */
export default function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const nestedAway = isNestedAwayFromMainTabs(pathname);
  const themeColor = resolveEventThemeColor(useEventStore((s) => s.currentEvent?.theme_color));
  const bottomPad = Math.max(insets.bottom, 10);

  const visible = state.routes
    .map((route, index) => ({ route, index }))
    .filter(({ route }) => isTabVisible(descriptors[route.key].options));

  return (
    <View style={[styles.chrome, { paddingBottom: bottomPad }]} pointerEvents="box-none">
      <View style={styles.capsule}>
        {visible.map(({ route, index }) => {
          const { options } = descriptors[route.key];
          // Never highlight a main tab while on nested profile/chat/booth/etc.
          let focused = !nestedAway && state.index === index;
          if (route.name === 'feed' && isFeedDetailPath(pathname)) {
            focused = false;
          }
          const color = focused ? themeColor : colors.textMuted;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : typeof options.title === 'string'
                ? options.title
                : route.name;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (event.defaultPrevented) return;

            // Always land on the tab root — never no-op when already "focused"
            // or when nested under profile / booth / feed detail.
            if (route.name === 'feed') {
              navigateToFeedRoot(navigation);
              return;
            }
            navigateToTabRoot(route.name, navigation);
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          const icon = options.tabBarIcon?.({
            focused,
            color,
            size: 20,
          });

          return (
            <PressScale
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              onPress={onPress}
              onLongPress={onLongPress}
              style={styles.item}
              scaleTo={0.94}
            >
              <View style={styles.itemInner}>
                {focused ? (
                  <View
                    style={[styles.activeWash, { backgroundColor: themeColor }]}
                    pointerEvents="none"
                  />
                ) : null}
                {icon}
                <Text style={[styles.label, { color }]} numberOfLines={1}>
                  {label}
                </Text>
              </View>
            </PressScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: {
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 28,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
      },
      android: {
        elevation: 10,
      },
      default: {},
    }),
  },
  item: {
    flex: 1,
  },
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 22,
    gap: 2,
    overflow: 'hidden',
  },
  activeWash: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.12,
    borderRadius: 22,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
});
