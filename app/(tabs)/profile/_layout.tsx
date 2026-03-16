import { Stack } from 'expo-router';
import { colors } from '../../../constants/colors';
import HamburgerMenu from '../../../components/HamburgerMenu';

export default function ProfileStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleAlign: 'left',
        headerShadowVisible: false,
        headerBackVisible: true,
        gestureEnabled: true,
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Profile',
          headerShown: true,
          headerLeft: () => <HamburgerMenu />,
          headerBackVisible: false,
        }}
      />
      <Stack.Screen name="edit" options={{ title: 'Edit Profile', headerBackTitle: 'Back' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications', headerBackTitle: 'Back' }} />
      <Stack.Screen name="announcements" options={{ title: 'Announcements', headerBackTitle: 'Back' }} />
      <Stack.Screen name="people" options={{ title: 'Community', headerShown: false }} />
      <Stack.Screen name="chat/[userId]" options={{ title: 'Chat', headerBackTitle: 'Back' }} />
      <Stack.Screen name="groups/index" options={{ title: 'Groups', headerBackTitle: 'Back' }} />
      <Stack.Screen name="groups/new" options={{ title: 'New group', headerBackTitle: 'Back' }} />
      <Stack.Screen name="groups/[groupId]" options={{ title: 'Group', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin" options={{ title: 'Event admin', headerShown: true }} />
      <Stack.Screen name="admin-all-events" options={{ title: 'All events', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-event-new" options={{ title: 'Create event', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-event-edit" options={{ title: 'Edit event', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-info-page" options={{ title: 'Edit info page', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-members" options={{ title: 'Members', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-posts" options={{ title: 'Moderate posts', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-announcement-new" options={{ title: 'New announcement', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-point-rules" options={{ title: 'Point rules', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-schedule" options={{ title: 'Manage schedule', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-schedule-edit" options={{ title: 'Add / Edit session', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-vendor-booths" options={{ title: 'Vendor booths (B2B)', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-vendor-booth-edit" options={{ title: 'Vendor booth', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-delete-user" options={{ title: 'Delete user account', headerBackTitle: 'Back' }} />
    </Stack>
  );
}
