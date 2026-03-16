import { Stack } from 'expo-router';

export default function ExpoLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[boothId]" options={{ headerShown: false }} />
    </Stack>
  );
}
