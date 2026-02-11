import { Stack } from 'expo-router';
import { colors } from '../../../constants/colors';

export default function ProfileStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerBackVisible: true,
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Profile', headerShown: true }} />
      <Stack.Screen name="edit" options={{ title: 'Edit Profile', headerBackTitle: 'Back' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications', headerBackTitle: 'Back' }} />
      <Stack.Screen name="people" options={{ title: 'Community', headerShown: false }} />
      <Stack.Screen name="chat/[userId]" options={{ title: 'Chat', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin" options={{ title: 'Event admin', headerShown: true }} />
      <Stack.Screen name="admin-event-new" options={{ title: 'Create event', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-event-edit" options={{ title: 'Edit event', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-info-page" options={{ title: 'Edit info page', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-members" options={{ title: 'Members', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-posts" options={{ title: 'Moderate posts', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-announcement-new" options={{ title: 'New announcement', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-point-rules" options={{ title: 'Point rules', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-schedule" options={{ title: 'Manage schedule', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-schedule-edit" options={{ title: 'Add / Edit session', headerBackTitle: 'Back' }} />
    </Stack>
  );
}
