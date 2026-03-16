import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { User } from 'lucide-react-native';
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

const headerStyles = StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  iconBtn: { marginHorizontal: 8, padding: 4, justifyContent: 'center', alignItems: 'center' },
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
    </Stack>
  );
}
