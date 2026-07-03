import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { colors } from '../../../constants/colors';
import { flatNativeStackHeaderStyle } from '../../../constants/headerStyle';

export default function ProfileStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: flatNativeStackHeaderStyle,
        headerTintColor: colors.text,
        headerTitleAlign: 'left',
        headerShadowVisible: false,
        headerBackVisible: true,
        gestureEnabled: true,
        ...(Platform.OS === 'ios' ? { headerBackButtonDisplayMode: 'minimal' as const } : {}),
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Profile',
          headerShown: false,
          headerBackVisible: false,
        }}
      />
      <Stack.Screen name="edit" options={{ title: 'Edit Profile', headerShown: false, headerBackTitle: 'Back' }} />
      <Stack.Screen name="change-password" options={{ title: 'Change password', headerShown: false, headerBackTitle: 'Back' }} />
      <Stack.Screen name="user-guide" options={{ title: 'How to use', headerShown: false, headerBackTitle: 'Back' }} />
      <Stack.Screen
        name="notifications"
        options={{ title: 'Notifications', headerShown: false, headerBackTitle: 'Back' }}
      />
      <Stack.Screen name="announcements" options={{ title: 'Announcements', headerShown: false, headerBackTitle: 'Back' }} />
      <Stack.Screen name="people" options={{ title: 'Community', headerShown: false }} />
      <Stack.Screen name="chat/[userId]" options={{ title: 'Chat', headerBackTitle: 'Back' }} />
      <Stack.Screen name="groups/index" options={{ title: 'Groups', headerShown: false, headerBackTitle: 'Back' }} />
      <Stack.Screen name="groups/new" options={{ title: 'New group', headerBackTitle: 'Back' }} />
      <Stack.Screen name="groups/[groupId]" options={{ title: 'Group', headerShown: false, headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin" options={{ title: 'Event admin', headerShown: false }} />
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
      <Stack.Screen name="admin-vendor-booths" options={{ title: 'Vendor booths (1:1 Meetings)', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-vendor-booth-edit" options={{ title: 'Vendor booth', headerBackTitle: 'Back' }} />
      <Stack.Screen name="admin-delete-user" options={{ title: 'Delete user account', headerBackTitle: 'Back' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Delete account', headerBackTitle: 'Back' }} />
      <Stack.Screen name="badge-scan" options={{ title: 'Scan badge', headerShown: false, headerBackTitle: 'Back' }} />
      <Stack.Screen name="session-check-in" options={{ title: 'Session check-in', headerShown: false, headerBackTitle: 'Back' }} />
      <Stack.Screen name="session-check-in-scan" options={{ title: 'Scan session', headerShown: false, headerBackTitle: 'Back' }} />
      <Stack.Screen name="badge-notes" options={{ title: 'Notes', headerShown: false, headerBackTitle: 'Back' }} />
    </Stack>
  );
}
