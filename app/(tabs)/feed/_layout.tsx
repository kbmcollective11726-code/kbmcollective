import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { ChevronLeft, User } from 'lucide-react-native';
import { colors } from '../../../constants/colors';
import { flatNativeStackHeaderStyle } from '../../../constants/headerStyle';
import { useEventThemeColor } from '../../../lib/eventTheme';
import { navigateToFeedRoot } from '../../../lib/navigateToFeedRoot';
import HeaderNotificationBell from '../../../components/HeaderNotificationBell';

function HeaderProfileButton() {
  const router = useRouter();
  const themeColor = useEventThemeColor();
  return (
    <TouchableOpacity
      onPress={() => router.push('/(tabs)/profile')}
      style={headerStyles.iconBtn}
      hitSlop={12}
      activeOpacity={0.85}
    >
      <User size={24} color={themeColor} strokeWidth={2} />
    </TouchableOpacity>
  );
}

function HeaderFeedBackButton() {
  const navigation = useNavigation();
  const themeColor = useEventThemeColor();
  return (
    <TouchableOpacity
      onPress={() => navigateToFeedRoot(navigation)}
      style={headerStyles.backBtn}
      hitSlop={12}
      activeOpacity={0.85}
    >
      <ChevronLeft size={20} color={themeColor} strokeWidth={2.25} />
      <Text style={[headerStyles.backText, { color: themeColor }]}>Feed</Text>
    </TouchableOpacity>
  );
}

const headerStyles = StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  iconBtn: { marginHorizontal: 8, padding: 4, justifyContent: 'center', alignItems: 'center' },
  backBtn: { marginLeft: 8, flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingRight: 8 },
  backText: { color: colors.primary, fontSize: 16, fontWeight: '600', marginLeft: -2 },
});

export default function FeedLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: flatNativeStackHeaderStyle,
        headerShadowVisible: false,
        headerBackVisible: true,
        gestureEnabled: true,
        headerRight: () => (
          <View style={headerStyles.headerRight}>
            <HeaderNotificationBell compact />
            <HeaderProfileButton />
          </View>
        ),
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="user/[userId]"
        options={{
          title: 'Profile',
          headerBackTitle: 'Back',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="comment/[postId]"
        options={{
          title: 'Comments',
          headerBackVisible: false,
          headerShown: true,
          headerLeft: () => <HeaderFeedBackButton />,
          headerRight: () => (
            <View style={headerStyles.headerRight}>
              <HeaderNotificationBell compact />
              <HeaderProfileButton />
            </View>
          ),
        }}
      />
    </Stack>
  );
}
