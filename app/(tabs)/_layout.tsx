import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Home, Calendar, User, ImageIcon, Trophy, Users } from 'lucide-react-native';
import { colors } from '../../constants/colors';
import PostFAB from '../../components/PostFAB';
import HamburgerMenu from '../../components/HamburgerMenu';

function HeaderProfileButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.push('/(tabs)/profile')}
      style={headerStyles.profileBtn}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <User size={24} color={colors.primary} strokeWidth={2} />
    </TouchableOpacity>
  );
}

const headerStyles = StyleSheet.create({
  profileBtn: {
    marginRight: 8,
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

const tabIcons: Record<string, (props: { color: string; size: number }) => React.ReactNode> = {
  index: Home,
  home: Home,
  feed: ImageIcon,
  community: Users,
  schedule: Calendar,
  leaderboard: Trophy,
  profile: User,
  'photo-book': ImageIcon,
};

const tabTitles: Record<string, string> = {
  index: 'Info',
  home: 'Info',
  feed: 'Feed',
  community: 'Community',
  schedule: 'Agenda',
  leaderboard: 'Rank',
  profile: 'Profile',
  'photo-book': 'Photo book',
};

const tabBarLabels: Record<string, string> = {
  index: 'Info',
  home: 'Info',
  feed: 'Feed',
  community: 'Community',
  schedule: 'Agenda',
  leaderboard: 'Rank',
};

const HIDDEN_FROM_TABS = ['profile', 'photo-book'];

export default function TabsLayout() {
  const router = useRouter();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={({ route }) => {
          const name = route.name === 'index' ? 'index' : route.name;
          const Icon = tabIcons[name] ?? User;
          const title = tabTitles[name] ?? route.name;
          const tabLabel = tabBarLabels[name] ?? title;
          const isHidden = HIDDEN_FROM_TABS.includes(route.name);
          return {
            href: isHidden ? null : undefined,
            headerShown: route.name !== 'feed',
            headerStyle: {
              backgroundColor: colors.background,
              borderBottomWidth: 1,
              borderBottomColor: colors.borderLight,
            },
            headerShadowVisible: false,
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '700', fontSize: 18 },
            headerLeftContainerStyle: { paddingLeft: 16 },
            headerRightContainerStyle: { paddingRight: 16 },
            headerLeft: () => <HamburgerMenu />,
            headerRight: () => <HeaderProfileButton />,
            title,
            tabBarLabel: isHidden ? '' : tabLabel,
            tabBarIcon: ({ color, size }: { color: string; size: number }) => <Icon color={color} size={size} />,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
            tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
            ...(route.name === 'feed' && {
              listeners: {
                tabPress: (e: { preventDefault: () => void }) => {
                  e.preventDefault();
                  router.navigate('/(tabs)/feed');
                },
              },
            }),
          };
        }}
      >
        <Tabs.Screen name="profile" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="photo-book" options={{ href: null }} />
      </Tabs>
      <PostFAB />
    </View>
  );
}
