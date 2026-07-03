import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
  Linking,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { History, X, Linkedin, ExternalLink, User, Calendar, Check } from 'lucide-react-native';
import { colors } from '../constants/colors';
import { formatB2BSlotRangeWallClock } from '../lib/b2bEventTime';
import { supabase, supabaseStorage } from '../lib/supabase';
import {
  fetchVendorAttendeeBrief,
  saveVendorAttendeeNote,
  type VendorAttendeeBrief,
  type VendorPriorMeeting,
  type VendorPriorNote,
} from '../lib/vendorAttendeeBrief';

type PriorEventGroup = {
  event_id: string;
  event_name: string;
  sortTs: number;
  meetings: VendorPriorMeeting[];
  notes: VendorPriorNote[];
};

/** Merge prior meetings + notes into one tile per event, most recent first. */
function groupPriorByEvent(data: VendorAttendeeBrief): PriorEventGroup[] {
  const map = new Map<string, PriorEventGroup>();
  const ensure = (eventId: string, eventName: string) => {
    let g = map.get(eventId);
    if (!g) {
      g = { event_id: eventId, event_name: eventName, sortTs: 0, meetings: [], notes: [] };
      map.set(eventId, g);
    }
    return g;
  };
  for (const m of data.prior_meetings) {
    const g = ensure(m.event_id, m.event_name);
    g.meetings.push(m);
    const ts = Date.parse(m.start_time) || 0;
    if (ts > g.sortTs) g.sortTs = ts;
  }
  for (const n of data.prior_notes) {
    const g = ensure(n.event_id, n.event_name);
    g.notes.push(n);
    const ts = Date.parse(n.created_at) || 0;
    if (ts > g.sortTs) g.sortTs = ts;
  }
  return [...map.values()].sort((a, b) => b.sortTs - a.sortTs);
}

type Props = {
  visible: boolean;
  onClose: () => void;
  eventId: string | null | undefined;
  subjectUserId: string | null;
  subjectName?: string;
  /** Role/company shown under the name (immediately, before the profile loads). Falls back to fetched brief. */
  subjectTitle?: string | null;
  subjectCompany?: string | null;
  /** This event's scheduled meeting time(s) with the attendee, shown at the top. */
  meetings?: { start: string; end: string }[];
  /** When true, shows an inline note editor that writes to the shared badge_scans row (by user id). */
  enableNotes?: boolean;
  /** When false, hides the "Prior interactions" history section (event admin toggle). Default true. */
  showPriorInteractions?: boolean;
  /** Existing saved note to prefill the editor. */
  initialNote?: string;
  /** Called after a successful note save with the new (trimmed) note text. */
  onNoteSaved?: (note: string) => void;
  /** Optional "View full profile" action; hidden when not provided. */
  onViewProfile?: () => void;
};

/** Vendor/admin-only pre-meeting brief: profile summary + "have we met before" history. */
export default function VendorAttendeeBriefModal({
  visible,
  onClose,
  eventId,
  subjectUserId,
  subjectName,
  subjectTitle,
  subjectCompany,
  meetings,
  enableNotes,
  showPriorInteractions = true,
  initialNote,
  onNoteSaved,
  onViewProfile,
}: Props) {
  const { height } = useWindowDimensions();
  const maxH = Math.round(height * 0.86);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<VendorAttendeeBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(subjectName ?? '');
  const [noteDraft, setNoteDraft] = useState(initialNote ?? '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setNoteDraft(initialNote ?? '');
    setNoteSaved(false);
    setNoteError(null);
  }, [visible, subjectUserId, initialNote]);

  const saveNote = async () => {
    if (!eventId || !subjectUserId || noteSaving) return;
    setNoteSaving(true);
    setNoteError(null);
    const trimmed = noteDraft.trim();
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    const res = await saveVendorAttendeeNote(eventId, subjectUserId, trimmed, client);
    setNoteSaving(false);
    if (res.error) {
      setNoteError('Could not save note. Please try again.');
      return;
    }
    setNoteSaved(true);
    onNoteSaved?.(trimmed);
    setTimeout(() => setNoteSaved(false), 2500);
  };

  useEffect(() => {
    if (!visible || !eventId || !subjectUserId) return;
    let cancelled = false;
    setName(subjectName ?? '');
    setData(null);
    setError(null);
    setLoading(true);
    const client = Platform.OS === 'android' ? supabaseStorage : supabase;
    fetchVendorAttendeeBrief(eventId, subjectUserId, client)
      .then(({ data: d, error: e }) => {
        if (cancelled) return;
        if (e || !d) {
          setError('Could not load this attendee’s details.');
        } else {
          setData(d);
          if (d.brief.full_name) setName(d.brief.full_name);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this attendee’s details.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, eventId, subjectUserId, subjectName]);

  const openUrl = (url: string | null) => {
    if (!url?.trim()) return;
    const u = url.startsWith('http') ? url : `https://${url}`;
    Linking.openURL(u).catch(() => {});
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <Pressable style={[s.content, { maxHeight: maxH }]} onPress={(e) => e.stopPropagation()}>
          <View style={s.headerRow}>
            <Text style={s.title} numberOfLines={1}>{name || 'Attendee'}</Text>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {(() => {
            const t = subjectTitle ?? data?.brief.title ?? null;
            const c = subjectCompany ?? data?.brief.company ?? null;
            const sub = [t, c].filter(Boolean).join(' · ');
            return sub ? <Text style={s.subtitleTop}>{sub}</Text> : null;
          })()}

          {meetings && meetings.length > 0 ? (
            <View style={s.meetingBox}>
              {meetings.map((m, i) => (
                <View key={`meet-${i}`} style={s.meetingRow}>
                  <Calendar size={15} color={colors.primary} />
                  <Text style={s.meetingText}>{formatB2BSlotRangeWallClock(m.start, m.end)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {enableNotes && eventId && subjectUserId ? (
            <View style={s.noteBox}>
              <Text style={s.sectionLabel}>Your notes</Text>
              <TextInput
                style={s.noteInput}
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="Add a private note about this attendee…"
                placeholderTextColor={colors.textMuted}
                multiline
                textAlignVertical="top"
              />
              {noteError ? <Text style={s.noteError}>{noteError}</Text> : null}
              <TouchableOpacity
                style={[s.noteSaveBtn, noteSaving && s.noteSaveBtnDisabled]}
                onPress={saveNote}
                disabled={noteSaving}
                activeOpacity={0.8}
              >
                {noteSaving ? (
                  <ActivityIndicator size="small" color={colors.textOnPrimary} />
                ) : noteSaved ? (
                  <>
                    <Check size={16} color={colors.textOnPrimary} />
                    <Text style={s.noteSaveText}>Saved</Text>
                  </>
                ) : (
                  <Text style={s.noteSaveText}>Save note</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {loading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : error ? (
            <Text style={s.errorText}>{error}</Text>
          ) : data ? (
            <ScrollView
              style={[s.scroll, { maxHeight: maxH - 60 }]}
              contentContainerStyle={s.scrollContent}
              showsVerticalScrollIndicator
            >
              {data.brief.bio ? (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>About</Text>
                  <Text style={s.bio}>{data.brief.bio}</Text>
                </View>
              ) : null}

              <View style={s.actionsRow}>
                {data.brief.linkedin_url ? (
                  <TouchableOpacity style={s.linkedinBtn} onPress={() => openUrl(data.brief.linkedin_url)}>
                    <Linkedin size={18} color={colors.primary} />
                    <Text style={s.linkedinText}>LinkedIn</Text>
                    <ExternalLink size={14} color={colors.primary} />
                  </TouchableOpacity>
                ) : null}
                {onViewProfile ? (
                  <TouchableOpacity style={s.profileBtn} onPress={onViewProfile}>
                    <User size={18} color={colors.primary} />
                    <Text style={s.linkedinText}>Full profile</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {showPriorInteractions ? (
              <View style={s.section}>
                <View style={s.metHeaderRow}>
                  <History size={16} color={data.met_before ? colors.primary : colors.textMuted} />
                  <Text style={s.sectionLabel}>Prior interactions</Text>
                </View>
                {!data.met_before ? (
                  <Text style={s.emptyText}>No prior interactions with your company on record.</Text>
                ) : (
                  groupPriorByEvent(data).map((g) => (
                    <View key={g.event_id} style={s.historyCard}>
                      <Text style={s.historyEvent}>{g.event_name}</Text>
                      {g.meetings.map((m, i) => (
                        <Text key={`m-${i}`} style={s.historyMeta}>
                          {formatB2BSlotRangeWallClock(m.start_time, m.end_time)}
                          {m.vendor_name ? ` · ${m.vendor_name}` : ''}
                        </Text>
                      ))}
                      {g.notes.map((n, i) => (
                        <View key={`n-${i}`} style={s.noteBlock}>
                          {n.note ? <Text style={s.noteText}>“{n.note}”</Text> : null}
                          <Text style={s.historyMeta}>
                            {n.scanner_name}
                            {n.attended_meeting ? ' · met' : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))
                )}
              </View>
              ) : null}
            </ScrollView>
          ) : null}
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  backdrop: { ...StyleSheet.absoluteFillObject },
  content: { backgroundColor: colors.card, borderRadius: 16, padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.text },
  closeBtn: { padding: 2 },
  meetingBox: {
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.primaryFaded,
    gap: 6,
  },
  meetingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meetingText: { fontSize: 15, fontWeight: '600', color: colors.text },
  noteBox: { marginTop: 12, marginBottom: 4 },
  noteInput: {
    marginTop: 6,
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  noteError: { fontSize: 13, color: colors.danger, marginTop: 6 },
  noteSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  noteSaveBtnDisabled: { opacity: 0.6 },
  noteSaveText: { fontSize: 15, fontWeight: '700', color: colors.textOnPrimary },
  loadingBox: { paddingVertical: 40, alignItems: 'center' },
  errorText: { fontSize: 15, color: colors.danger, paddingVertical: 20 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: 24 },
  subtitle: { fontSize: 15, color: colors.textSecondary, marginBottom: 12 },
  subtitleTop: { fontSize: 15, color: colors.textSecondary, marginTop: 2, marginBottom: 4 },
  section: { marginTop: 8, marginBottom: 12 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.4 },
  bio: { fontSize: 15, color: colors.text, lineHeight: 22, marginTop: 6 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  linkedinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.primaryFaded,
  },
  profileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.primaryFaded,
  },
  linkedinText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  metHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic' },
  historyGroup: { marginTop: 8 },
  historySubLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  historyEvent: { fontSize: 14, fontWeight: '700', color: colors.text },
  noteBlock: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border },
  historyMeta: { fontSize: 13, color: colors.textMuted, marginTop: 3 },
  noteText: { fontSize: 14, color: colors.text, fontStyle: 'italic', marginTop: 4, lineHeight: 20 },
});
