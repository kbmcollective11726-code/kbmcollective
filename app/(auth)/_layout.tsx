import { Stack } from 'expo-router';
import { colors } from '../../constants/colors';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerBackVisible: true,
        headerBackTitle: 'Back',
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ title: 'Sign up', headerBackTitle: 'Back' }} />
    </Stack>
  );
}
