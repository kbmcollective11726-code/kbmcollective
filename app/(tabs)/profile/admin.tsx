import { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { ChevronRight, Calendar, Users, ImageIcon, Megaphone, CalendarDays, FileText, PlusCircle, Award, Building2 } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { useEventStore } from '../../../stores/eventStore';
import { colors } from '../../../constants/colors';

export default function AdminScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { user } = useAuthStore();
  const { currentEvent } = useEventStore();
  const isPlatformAdmin = user?.is_platform_admin === true;

  useEffect(() => {
    if (from && typeof from === 'string') {
      const returnPath = decodeURIComponent(from);
      navigation.setOptions({
        headerBackVisible: false,
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => router.replace(returnPath as any)}
            style={{ marginLeft: 8, padding: 4 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={24} color={colors.text} />
          </TouchableOpacity>
        ),
      });
    }
  }, [from, navigation, router]);

  if (!currentEvent) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.subtitle}>Select an event on the Info tab to manage it, or create a new event.</Text>
          <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/profile/admin-event-new')}>
            <PlusCircle size={24} color={colors.textOnPrimary} />
            <Text style={styles.createBtnText}>Create new event</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const menu = [
    ...(isPlatformAdmin ? [{ key: 'all-events', title: 'All events (platform)', icon: Building2, href: '/profile/admin-all-events' }] : []),
    { key: 'create', title: 'Create new event', icon: PlusCircle, href: '/profile/admin-event-new' },
    { key: 'event', title: 'Edit event', icon: Calendar, href: '/profile/admin-event-edit' },
    { key: 'info', title: 'Edit info page', icon: FileText, href: '/profile/admin-info-page' },
    { key: 'points', title: 'Point rules', icon: Award, href: '/profile/admin-point-rules' },
    { key: 'schedule', title: 'Manage schedule', icon: CalendarDays, href: '/profile/admin-schedule' },
    { key: 'members', title: 'Manage members', icon: Users, href: '/profile/admin-members' },
    { key: 'posts', title: 'Moderate posts', icon: ImageIcon, href: '/profile/admin-posts' },
    { key: 'announcement', title: 'New announcement', icon: Megaphone, href: '/profile/admin-announcement-new' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eventName}>{currentEvent.name}</Text>
        <View style={styles.menu}>
          {menu.map(({ key, title, icon: Icon, href }) => (
            <TouchableOpacity
              key={key}
              style={styles.menuRow}
              onPress={() => router.push(href as any)}
              activeOpacity={0.7}
            >
              <Icon size={22} color={colors.textSecondary} />
              <Text style={styles.menuText}>{title}</Text>
              <ChevronRight size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24 },
  placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 24 },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
  },
  createBtnText: { fontSize: 16, fontWeight: '600', color: colors.textOnPrimary },
  eventName: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 20 },
  menu: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  menuText: { flex: 1, fontSize: 16, color: colors.text, fontWeight: '500' },
});
