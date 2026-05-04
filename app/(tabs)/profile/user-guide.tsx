import { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '../../../constants/colors';
import ProfileStackScreenHeader from '../../../components/ProfileStackScreenHeader';

type Block = { title: string; lines: string[] };

const BLOCKS: Block[] = [
  {
    title: 'Getting started',
    lines: [
      'Use the menu (☰) to move between areas. Pick your event from Home if you belong to more than one.',
    ],
  },
  {
    title: 'Info',
    lines: ['Event details, venue, and updates from organizers.'],
  },
  {
    title: 'Feed',
    lines: ['See posts from attendees, comment, and share updates.'],
  },
  {
    title: 'Agenda',
    lines: ['Browse sessions and add them to your plan.'],
  },
  {
    title: 'Rank',
    lines: ['Leaderboard and points for this event.'],
  },
  {
    title: 'Community',
    lines: ['Find people, message, and join groups when your event enables them.'],
  },
  {
    title: '1:1 Meetings & Photo book',
    lines: ['1:1 Meetings: vendor booths and meetings. Photo book: event photos.'],
  },
  {
    title: 'Live wall',
    lines: ['Opens the live display for this event (from the menu).'],
  },
  {
    title: 'Notifications',
    lines: ['Alerts for announcements, messages, and reminders. Adjust in Profile → Notifications.'],
  },
  {
    title: 'Profile',
    lines: [
      'Update your photo and details, change password, and manage account options here.',
      'Event admins get extra tools under Event admin.',
    ],
  },
];

export default function UserGuideScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();

  const goBack = useCallback(() => {
    const returnPath = from && typeof from === 'string' ? decodeURIComponent(from).trim() : null;
    if (returnPath) {
      router.replace(returnPath as any);
    } else {
      router.back();
    }
  }, [from, router]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileStackScreenHeader variant="back" title="How to use" onBack={goBack} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lead}>
          A quick overview of KBM Connect. Everything stays in the app—no website required.
        </Text>
        {BLOCKS.map((block) => (
          <View key={block.title} style={styles.block}>
            <Text style={styles.blockTitle}>{block.title}</Text>
            {block.lines.map((line, i) => (
              <Text key={i} style={styles.line}>
                {line}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  lead: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: 20,
  },
  block: {
    marginBottom: 20,
  },
  blockTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  line: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginBottom: 6,
  },
});
