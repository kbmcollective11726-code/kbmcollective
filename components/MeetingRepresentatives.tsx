import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { UserRound } from 'lucide-react-native';
import Avatar from './Avatar';
import { colors } from '../constants/colors';
import type { BoothRepresentative } from '../lib/vendorBoothReps';

type Props = {
  representatives: BoothRepresentative[];
  /** compact = list cards; full = meeting detail card */
  variant?: 'compact' | 'full';
  label?: string;
};

export default function MeetingRepresentatives({
  representatives,
  variant = 'compact',
  label = 'Representatives',
}: Props) {
  const router = useRouter();
  if (representatives.length === 0) return null;

  const openProfile = (userId: string) => {
    router.push(`/(tabs)/feed/user/${userId}` as any);
  };

  if (variant === 'compact') {
    return (
      <View style={s.compactWrap}>
        <Text style={s.compactLabel}>{label}</Text>
        {representatives.map((rep) => (
          <TouchableOpacity
            key={rep.user_id}
            style={s.compactRow}
            activeOpacity={0.75}
            onPress={() => openProfile(rep.user_id)}
          >
            <Avatar uri={rep.avatar_url} name={rep.full_name} size={28} />
            <Text style={s.compactName} numberOfLines={1}>
              {rep.full_name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <View style={s.fullWrap}>
      <Text style={s.fullLabel}>{label}</Text>
      {representatives.map((rep) => {
        const subtitle = [rep.title, rep.company].filter(Boolean).join(' · ');
        return (
          <Pressable key={rep.user_id} style={s.fullRow} onPress={() => openProfile(rep.user_id)}>
            <Avatar uri={rep.avatar_url} name={rep.full_name} size={40} />
            <View style={s.fullTextCol}>
              <Text style={s.fullName} numberOfLines={1}>
                {rep.full_name}
              </Text>
              {subtitle ? (
                <Text style={s.fullSubtitle} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : (
                <Text style={s.fullSubtitleMuted}>Tap to view profile</Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MeetingRepresentativesPlaceholder({ label = 'Representatives' }: { label?: string }) {
  return (
    <View style={s.compactWrap}>
      <View style={s.compactRow}>
        <UserRound size={16} color={colors.textMuted} />
        <Text style={s.mutedText}>{label} not listed for this booth yet.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  compactWrap: { marginTop: 8, gap: 6 },
  compactLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compactName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  fullWrap: { marginTop: 12, gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  fullLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  fullRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fullTextCol: { flex: 1, minWidth: 0 },
  fullName: { fontSize: 15, fontWeight: '700', color: colors.text },
  fullSubtitle: { marginTop: 2, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  fullSubtitleMuted: { marginTop: 2, fontSize: 13, color: colors.textMuted },
  mutedText: { fontSize: 13, color: colors.textMuted, flex: 1 },
});
