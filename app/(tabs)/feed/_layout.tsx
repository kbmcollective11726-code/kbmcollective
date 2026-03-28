import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, User } from 'lucide-react-native';
import { colors } from '../../../constants/colors';
import HeaderNotificationBell from '../../../components/HeaderNotificationBell';

function HeaderProfileButton() {
  const router = useRouter();
  return (
    <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} style={headerStyles.iconBtn} hitSlop={12}>
      <User size={24} color={colors.primary} strokeWidth={2} />
    </TouchableOpacity>
  );
}

function HeaderFeedBackButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => {
        router.replace('/(tabs)/feed' as any);
      }}
      style={headerStyles.backBtn}
      hitSlop={12}
    >
      <ChevronLeft size={20} color={colors.primary} strokeWidth={2.25} />
      <Text style={headerStyles.backText}>Feed</Text>
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
        headerStyle: { backgroundColor: colors.background },
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
          headerShown: true,
          headerRight: () => (
            <View style={headerStyles.headerRight}>
              <HeaderNotificationBell compact />
              <HeaderProfileButton />
            </View>
          ),
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
