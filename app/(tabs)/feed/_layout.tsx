import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { User } from 'lucide-react-native';
import { colors } from '../../../constants/colors';
import HamburgerMenu from '../../../components/HamburgerMenu';

function HeaderProfileButton() {
  const router = useRouter();
  return (
    <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} style={headerStyles.iconBtn} hitSlop={12}>
      <User size={24} color={colors.primary} strokeWidth={2} />
    </TouchableOpacity>
  );
}

const headerStyles = StyleSheet.create({
  iconBtn: { marginHorizontal: 8, padding: 4, justifyContent: 'center', alignItems: 'center' },
});

export default function FeedLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerBackVisible: true,
        gestureEnabled: true,
        headerLeft: () => <HamburgerMenu />,
        headerRight: () => <HeaderProfileButton />,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Feed', headerShown: true }} />
      <Stack.Screen
        name="user/[userId]"
        options={{ title: 'Profile', headerBackTitle: 'Back', headerShown: true }}
      />
    </Stack>
  );
}
