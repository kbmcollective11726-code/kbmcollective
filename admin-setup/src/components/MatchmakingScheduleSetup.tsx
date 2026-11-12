import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addMinutesToDatetimeLocalWallClock,
  datetimeLocalToUtcIsoWallClock,
  utcIsoToDatetimeLocalWallClock,
} from '../lib/b2bEventTime';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { supabase } from '../lib/supabase';
import {
  DEFAULT_AUTO_SLOT_SETTINGS,
  type AutoSlotDefaults,
} from '../lib/matchmakingAutoSchedule';
import {
  formatSlotDayLabel,
  formatSlotTimeOnly,
  slotDayKey,
} from '../lib/matchmakingScheduleQueue';
import type {
  EventMatchmakingLocation,
  EventMatchmakingTimeSlot,
  EventRegistrationSubmission,
} from '../lib/types';
import styles from '../pages/EventMatchmaking.module.css';

interface Props {
  eventId: string;
  onConfigurationChange?: () => void | Promise<void>;
  onDefaultsChange?: (defaults: AutoSlotDefaults) => void;
}

interface ScheduleSettings extends AutoSlotDefaults {
  max_meetings_per_attendee: number;
  schedule_locked: boolean;
  availability_deadline: string | null;
}

type DiaryRow = Pick<
  EventRegistrationSubmission,
  | 'id'
  | 'first_name'
  | 'last_name'
  | 'company_name'
  | 'attendee_type'
  | 'concurrent_meetings_per_slot'
  | 'meetings_enabled'
  | 'max_meetings'
>;

const DEFAULT_SETTINGS: ScheduleSettings = {
  ...DEFAULT_AUTO_SLOT_SETTINGS,
  max_meetings_per_attendee: 8,
  schedule_locked: false,
  availability_deadline: null,
};

/** Stored hour 0–23 (start) or 1–24 (end, 24 = midnight). */
function formatHour12(hourStored: number): string {
  const h = hourStored === 24 ? 0 : ((hourStored % 24) + 24) % 24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${ampm}`;
}

const DAY_START_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: formatHour12(hour),
}));

const DAY_END_HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const value = i + 1; // 1–24
  return { value, label: formatHour12(value) };
});

function Badge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'success' | 'warn' | 'muted' | 'danger' | 'info';
}) {
  return <span className={`${styles.statusBadge} ${styles[`statusBadge_${tone}`]}`}>{label}</span>;
}

export default function MatchmakingScheduleSetup({
  eventId,
  onConfigurationChange,
  onDefaultsChange,
}: Props) {
  const [slots, setSlots] = useState<EventMatchmakingTimeSlot[]>([]);
  const [locations, setLocations] = useState<EventMatchmakingLocation[]>([]);
  const [settings, setSettings] = useState<ScheduleSettings>(DEFAULT_SETTINGS);
  const [diaryRows, setDiaryRows] = useState<DiaryRow[]>([]);
  const [diaryDrafts, setDiaryDrafts] = useState<Record<string, number>>({});
  const [maxMeetingDrafts, setMaxMeetingDrafts] = useState<Record<string, string>>({});
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [slotLabel, setSlotLabel] = useState('');
  const [editingSlotId, setEditingSlotId] = useState('');
  const [editingSlotStart, setEditingSlotStart] = useState('');
  const [editingSlotEnd, setEditingSlotEnd] = useState('');
  const [editingSlotLabel, setEditingSlotLabel] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationCapacity, setLocationCapacity] = useState(1);
  const [locationVendorId, setLocationVendorId] = useState('');
  const [editingLocationId, setEditingLocationId] = useState('');
  const [editingLocationName, setEditingLocationName] = useState('');
  const [editingLocationCapacity, setEditingLocationCapacity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [slotMeetingCounts, setSlotMeetingCounts] = useState<Record<string, number>>({});
  const [slotAvailabilityCounts, setSlotAvailabilityCounts] = useState<Record<string, number>>({});
  const [locationMeetingCounts, setLocationMeetingCounts] = useState<Record<string, number>>({});
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [slotResult, locationResult, settingsResult, diaryResult, meetingResult, availabilityResult] = await Promise.all([
      supabase
        .from('event_matchmaking_time_slots')
        .select('*')
        .eq('event_id', eventId)
        .order('start_time', { ascending: true }),
      supabase
        .from('event_matchmaking_locations')
        .select('*')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('event_matchmaking_settings')
        .select(
          'max_meetings_per_attendee, schedule_locked, availability_deadline, default_meeting_minutes, auto_slot_start_hour, auto_slot_end_hour',
        )
        .eq('event_id', eventId)
        .maybeSingle(),
      supabase
        .from('event_registration_submissions')
        .select(
          'id, first_name, last_name, company_name, attendee_type, concurrent_meetings_per_slot, meetings_enabled, max_meetings',
        )
        .eq('event_id', eventId)
        .eq('attendee_type', 'vendor')
        .order('company_name', { ascending: true }),
      supabase
        .from('event_match_scheduled_meetings')
        .select('time_slot_id, location_id')
        .eq('event_id', eventId)
        .eq('status', 'scheduled')
        .or('time_slot_id.not.is.null,location_id.not.is.null'),
      supabase
        .from('event_matchmaking_availability')
        .select('time_slot_id')
        .eq('event_id', eventId),
    ]);
    const firstError =
      slotResult.error ??
      locationResult.error ??
      settingsResult.error ??
      meetingResult.error ??
      availabilityResult.error;
    if (firstError) {
      setError(postgrestErrorMessage(firstError) || 'Could not load schedule setup');
    } else {
      setSlots((slotResult.data as EventMatchmakingTimeSlot[]) ?? []);
      setLocations((locationResult.data as EventMatchmakingLocation[]) ?? []);
      const counts: Record<string, number> = {};
      const locationCounts: Record<string, number> = {};
      for (const row of (meetingResult.data as { time_slot_id: string | null; location_id: string | null }[] | null) ?? []) {
        if (row.time_slot_id) {
          counts[row.time_slot_id] = (counts[row.time_slot_id] ?? 0) + 1;
        }
        if (row.location_id) {
          locationCounts[row.location_id] = (locationCounts[row.location_id] ?? 0) + 1;
        }
      }
      setSlotMeetingCounts(counts);
      setLocationMeetingCounts(locationCounts);
      const availabilityCounts: Record<string, number> = {};
      for (const row of (availabilityResult.data as { time_slot_id: string }[] | null) ?? []) {
        availabilityCounts[row.time_slot_id] = (availabilityCounts[row.time_slot_id] ?? 0) + 1;
      }
      setSlotAvailabilityCounts(availabilityCounts);
      const row = settingsResult.data as Partial<ScheduleSettings> | null;
      setSettings({
        max_meetings_per_attendee: row?.max_meetings_per_attendee ?? 8,
        schedule_locked: row?.schedule_locked === true,
        availability_deadline: row?.availability_deadline ?? null,
        default_meeting_minutes:
          row?.default_meeting_minutes ?? DEFAULT_AUTO_SLOT_SETTINGS.default_meeting_minutes,
        auto_slot_start_hour:
          row?.auto_slot_start_hour ?? DEFAULT_AUTO_SLOT_SETTINGS.auto_slot_start_hour,
        auto_slot_end_hour: row?.auto_slot_end_hour ?? DEFAULT_AUTO_SLOT_SETTINGS.auto_slot_end_hour,
      });
      onDefaultsChange?.({
        default_meeting_minutes:
          row?.default_meeting_minutes ?? DEFAULT_AUTO_SLOT_SETTINGS.default_meeting_minutes,
        auto_slot_start_hour:
          row?.auto_slot_start_hour ?? DEFAULT_AUTO_SLOT_SETTINGS.auto_slot_start_hour,
        auto_slot_end_hour: row?.auto_slot_end_hour ?? DEFAULT_AUTO_SLOT_SETTINGS.auto_slot_end_hour,
      });
      if (diaryResult.error) {
        setDiaryRows([]);
      } else {
        setDiaryRows((diaryResult.data as DiaryRow[]) ?? []);
      }
    }
    setLoading(false);
  }, [eventId, onDefaultsChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, EventMatchmakingTimeSlot[]>();
    for (const slot of slots) {
      const key = slotDayKey(slot.start_time);
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  const activeSlotCount = slots.filter((s) => s.is_active).length;
  const activeLocationCount = locations.filter((l) => l.is_active).length;

  const changed = async () => {
    await load();
    await onConfigurationChange?.();
  };

  const addSlot = async () => {
    const start = datetimeLocalToUtcIsoWallClock(slotStart);
    const end = datetimeLocalToUtcIsoWallClock(slotEnd);
    if (!start || !end) {
      setError('Choose a start and end time.');
      return;
    }
    if (new Date(end) <= new Date(start)) {
      setError('The slot end must be after its start.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('event_matchmaking_time_slots').insert({
        event_id: eventId,
        start_time: start,
        end_time: end,
        label: slotLabel.trim() || null,
        sort_order: slots.length,
      });
      if (insertError) throw insertError;
      setSlotLabel('');
      setSlotStart('');
      setSlotEnd('');
      setNotice('Meeting time slot added.');
      await changed();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not add time slot');
    } finally {
      setBusy(false);
    }
  };

  const beginEditSlot = (slot: EventMatchmakingTimeSlot) => {
    setEditingSlotId(slot.id);
    setEditingSlotStart(utcIsoToDatetimeLocalWallClock(slot.start_time));
    setEditingSlotEnd(utcIsoToDatetimeLocalWallClock(slot.end_time));
    setEditingSlotLabel(slot.label ?? '');
    setError('');
    setNotice('');
  };

  const cancelEditSlot = () => {
    setEditingSlotId('');
    setEditingSlotStart('');
    setEditingSlotEnd('');
    setEditingSlotLabel('');
  };

  const saveSlotEdit = async (slot: EventMatchmakingTimeSlot) => {
    const meetingCount = slotMeetingCounts[slot.id] ?? 0;
    const availabilityCount = slotAvailabilityCounts[slot.id] ?? 0;
    if (meetingCount > 0 || availabilityCount > 0) {
      setError('This slot is already in use. Hide it instead of editing it.');
      return;
    }
    const start = datetimeLocalToUtcIsoWallClock(editingSlotStart);
    const end = datetimeLocalToUtcIsoWallClock(editingSlotEnd);
    if (!start || !end) {
      setError('Choose a start and end time.');
      return;
    }
    if (new Date(end) <= new Date(start)) {
      setError('The slot end must be after its start.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('event_matchmaking_time_slots')
        .update({
          start_time: start,
          end_time: end,
          label: editingSlotLabel.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', slot.id)
        .eq('event_id', eventId);
      if (updateError) throw updateError;
      cancelEditSlot();
      setNotice('Meeting time slot updated.');
      await changed();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not update time slot');
    } finally {
      setBusy(false);
    }
  };

  const deleteSlot = async (slot: EventMatchmakingTimeSlot) => {
    const meetingCount = slotMeetingCounts[slot.id] ?? 0;
    const availabilityCount = slotAvailabilityCounts[slot.id] ?? 0;
    if (meetingCount > 0 || availabilityCount > 0) {
      setError('This slot is already in use. Hide it instead of deleting it.');
      return;
    }
    if (!window.confirm(`Delete the ${formatSlotTimeOnly(slot.start_time, slot.end_time)} time slot?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: deleteError } = await supabase
        .from('event_matchmaking_time_slots')
        .delete()
        .eq('id', slot.id)
        .eq('event_id', eventId);
      if (deleteError) throw deleteError;
      setSelectedSlotIds((current) => {
        const next = new Set(current);
        next.delete(slot.id);
        return next;
      });
      setNotice('Meeting time slot deleted.');
      await changed();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not delete time slot');
    } finally {
      setBusy(false);
    }
  };

  const vendorLabel = (row: DiaryRow) => {
    const person = [row.first_name, row.last_name].filter(Boolean).join(' ');
    if (row.company_name && person) return `${row.company_name} · ${person}`;
    return row.company_name || person || 'Vendor';
  };

  const vendorById = useMemo(() => new Map(diaryRows.map((row) => [row.id, row])), [diaryRows]);

  const addLocation = async () => {
    const name = locationName.trim();
    if (!name) {
      setError('Enter a location or booth name.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: insertError } = await supabase.from('event_matchmaking_locations').insert({
        event_id: eventId,
        name,
        capacity: Math.max(1, locationCapacity),
        sort_order: locations.length,
        vendor_submission_id: locationVendorId || null,
      });
      if (insertError) throw insertError;
      setLocationName('');
      setLocationCapacity(1);
      setLocationVendorId('');
      setNotice(
        locationVendorId
          ? 'Booth added and attached to vendor.'
          : 'Meeting location added. You can attach a vendor anytime.',
      );
      await changed();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not add location');
    } finally {
      setBusy(false);
    }
  };

  const beginEditLocation = (location: EventMatchmakingLocation) => {
    setEditingLocationId(location.id);
    setEditingLocationName(location.name);
    setEditingLocationCapacity(Math.max(1, location.capacity));
    setError('');
    setNotice('');
  };

  const cancelEditLocation = () => {
    setEditingLocationId('');
    setEditingLocationName('');
    setEditingLocationCapacity(1);
  };

  const saveLocationEdit = async (location: EventMatchmakingLocation) => {
    const meetingCount = locationMeetingCounts[location.id] ?? 0;
    if (meetingCount > 0) {
      setError('This location has scheduled meetings. Hide it instead of editing it.');
      return;
    }
    const name = editingLocationName.trim();
    const capacity = Math.max(1, Math.floor(editingLocationCapacity) || 1);
    if (!name) {
      setError('Enter a location or booth name.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('event_matchmaking_locations')
        .update({
          name,
          capacity,
          updated_at: new Date().toISOString(),
        })
        .eq('id', location.id)
        .eq('event_id', eventId);
      if (updateError) throw updateError;
      cancelEditLocation();
      setNotice('Meeting location updated.');
      await changed();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not update location');
    } finally {
      setBusy(false);
    }
  };

  const deleteLocation = async (location: EventMatchmakingLocation) => {
    const meetingCount = locationMeetingCounts[location.id] ?? 0;
    if (meetingCount > 0) {
      setError('This location has scheduled meetings. Hide it instead of deleting it.');
      return;
    }
    if (location.vendor_submission_id || location.vendor_booth_id) {
      setError('Unassign the vendor before deleting this location. Hide it if the booth should remain available.');
      return;
    }
    if (!window.confirm(`Delete the "${location.name}" location?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: deleteError } = await supabase
        .from('event_matchmaking_locations')
        .delete()
        .eq('id', location.id)
        .eq('event_id', eventId);
      if (deleteError) throw deleteError;
      setNotice('Meeting location deleted.');
      await changed();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not delete location');
    } finally {
      setBusy(false);
    }
  };

  const assignLocationVendor = async (locationId: string, vendorSubmissionId: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('event_matchmaking_locations')
        .update({
          vendor_submission_id: vendorSubmissionId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', locationId)
        .eq('event_id', eventId);
      if (updateError) throw updateError;

      if (vendorSubmissionId) {
        // Ensure Solution Provider booth exists even if the location trigger no-ops.
        const { data: boothId, error: boothErr } = await supabase.rpc('ensure_matchmaking_vendor_booth', {
          p_submission_id: vendorSubmissionId,
        });
        if (boothErr) throw boothErr;

        const { data: locRow } = await supabase
          .from('event_matchmaking_locations')
          .select('name, vendor_booth_id')
          .eq('id', locationId)
          .maybeSingle();
        const linkedBoothId =
          (locRow as { vendor_booth_id?: string | null } | null)?.vendor_booth_id ||
          (typeof boothId === 'string' ? boothId : null);

        if (!linkedBoothId) {
          setError(
            'Vendor attached, but no Solution Provider booth was created. Check matching opt-in and meetings enabled on that registration, then Approve again.',
          );
        } else {
          const tableName = String((locRow as { name?: string } | null)?.name ?? '').trim();
          if (tableName) {
            await supabase
              .from('vendor_booths')
              .update({ booth_location: tableName, is_active: true })
              .eq('id', linkedBoothId);
          }
          setNotice('Booth attached — Solution Provider tile updated for the app.');
        }
      } else {
        setNotice('Vendor removed from booth.');
      }

      setLocations((current) =>
        current.map((loc) =>
          loc.id === locationId
            ? { ...loc, vendor_submission_id: vendorSubmissionId || null }
            : loc,
        ),
      );
      await onConfigurationChange?.();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not attach vendor to booth');
    } finally {
      setBusy(false);
    }
  };

  const toggleRow = async (
    table: 'event_matchmaking_time_slots' | 'event_matchmaking_locations',
    id: string,
    isActive: boolean,
  ) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from(table)
        .update({ is_active: !isActive, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('event_id', eventId);
      if (updateError) throw updateError;
      setNotice(isActive ? 'Item hidden from new scheduling.' : 'Item restored.');
      await changed();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not update schedule setup');
    } finally {
      setBusy(false);
    }
  };

  const toggleSlotSelected = (slotId: string) => {
    setSelectedSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  };

  const selectDaySlots = (daySlots: EventMatchmakingTimeSlot[], select: boolean) => {
    setSelectedSlotIds((prev) => {
      const next = new Set(prev);
      for (const slot of daySlots) {
        if (select) next.add(slot.id);
        else next.delete(slot.id);
      }
      return next;
    });
  };

  const bulkSetSlotsActive = async (makeActive: boolean) => {
    const ids = [...selectedSlotIds];
    if (ids.length === 0) {
      setError('Select at least one time slot.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('event_matchmaking_time_slots')
        .update({ is_active: makeActive, updated_at: new Date().toISOString() })
        .eq('event_id', eventId)
        .in('id', ids);
      if (updateError) throw updateError;
      setNotice(
        makeActive
          ? `Restored ${ids.length} time slot${ids.length === 1 ? '' : 's'}.`
          : `Hidden ${ids.length} time slot${ids.length === 1 ? '' : 's'} from new scheduling.`,
      );
      setSelectedSlotIds(new Set());
      await changed();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not update time slots');
    } finally {
      setBusy(false);
    }
  };

  const saveRules = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase.from('event_matchmaking_settings').upsert({
        event_id: eventId,
        max_meetings_per_attendee: Math.max(0, settings.max_meetings_per_attendee),
        schedule_locked: settings.schedule_locked,
        availability_deadline: settings.availability_deadline,
        default_meeting_minutes: Math.max(5, Math.min(180, settings.default_meeting_minutes || 30)),
        auto_slot_start_hour: Math.max(0, Math.min(23, settings.auto_slot_start_hour ?? 9)),
        auto_slot_end_hour: Math.max(1, Math.min(24, settings.auto_slot_end_hour ?? 17)),
        updated_at: new Date().toISOString(),
      });
      if (updateError) throw updateError;
      setNotice(
        settings.schedule_locked
          ? 'Schedule locked. Participants cannot change availability and no new meetings can be scheduled.'
          : 'Scheduling rules saved.',
      );
      onDefaultsChange?.({
        default_meeting_minutes: settings.default_meeting_minutes,
        auto_slot_start_hour: settings.auto_slot_start_hour,
        auto_slot_end_hour: settings.auto_slot_end_hour,
      });
      await changed();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not save scheduling rules');
    } finally {
      setBusy(false);
    }
  };

  const saveVendorPackage = async (
    submissionId: string,
    patch: Partial<Pick<DiaryRow, 'meetings_enabled' | 'max_meetings' | 'concurrent_meetings_per_slot'>>,
  ) => {
    const existing = diaryRows.find((row) => row.id === submissionId);
    if (!existing) return;
    const nextEnabled = patch.meetings_enabled ?? existing.meetings_enabled !== false;
    const nextMax =
      patch.max_meetings !== undefined ? patch.max_meetings : (existing.max_meetings ?? null);
    const nextDiaries =
      patch.concurrent_meetings_per_slot !== undefined
        ? Math.max(1, Math.min(20, Math.floor(patch.concurrent_meetings_per_slot) || 1))
        : (existing.concurrent_meetings_per_slot ?? 1);
    if (
      nextEnabled === (existing.meetings_enabled !== false) &&
      nextMax === (existing.max_meetings ?? null) &&
      nextDiaries === (existing.concurrent_meetings_per_slot ?? 1)
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase
        .from('event_registration_submissions')
        .update({
          meetings_enabled: nextEnabled,
          max_meetings: nextEnabled ? nextMax : 0,
          concurrent_meetings_per_slot: nextDiaries,
          updated_at: new Date().toISOString(),
        })
        .eq('id', submissionId);
      if (updateError) throw updateError;
      setDiaryRows((current) =>
        current.map((item) =>
          item.id === submissionId
            ? {
                ...item,
                meetings_enabled: nextEnabled,
                max_meetings: nextEnabled ? nextMax : 0,
                concurrent_meetings_per_slot: nextDiaries,
              }
            : item,
        ),
      );
      setNotice(
        nextEnabled
          ? 'Vendor meeting package updated.'
          : 'Meetings turned off for this vendor.',
      );
      await onConfigurationChange?.();
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not update vendor meeting package');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading schedule setup…</div>;

  return (
    <div className={styles.setupStack}>
      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.success}>{notice}</p> : null}

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{activeSlotCount}</span>
          <span className={styles.statLabel}>Active slots</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{activeLocationCount}</span>
          <span className={styles.statLabel}>Active booths</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{settings.default_meeting_minutes}m</span>
          <span className={styles.statLabel}>Default length</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{settings.schedule_locked ? 'Locked' : 'Open'}</span>
          <span className={styles.statLabel}>Schedule</span>
        </div>
      </div>

      <div className={styles.setupTwoCol}>
        <section className={styles.setupPanel}>
          <div className={styles.setupPanelHeader}>
            <h3>Meeting time slots</h3>
            <Badge label={`${slots.length} total`} tone="info" />
          </div>
          <p className={styles.setupPanelHint}>
            Add the meeting windows used when you approve matches. Select multiple slots to hide or
            restore at once (e.g. speaker sessions). Grouped by day below.
          </p>

          <div className={styles.setupFormRow}>
            <label className={styles.field}>
              <span>Start</span>
              <input
                type="datetime-local"
                value={slotStart}
                onChange={(event) => {
                  const next = event.target.value;
                  setSlotStart(next);
                  if (!slotEnd || slotEnd <= next) {
                    setSlotEnd(
                      addMinutesToDatetimeLocalWallClock(next, settings.default_meeting_minutes || 30),
                    );
                  }
                }}
              />
            </label>
            <label className={styles.field}>
              <span>End</span>
              <input
                type="datetime-local"
                value={slotEnd}
                onChange={(event) => setSlotEnd(event.target.value)}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Label (optional)</span>
              <input
                value={slotLabel}
                onChange={(event) => setSlotLabel(event.target.value)}
                placeholder="Morning session"
              />
            </label>
            <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void addSlot()}>
              Add slot
            </button>
          </div>

          {selectedSlotIds.size > 0 ? (
            <div className={styles.setupBulkBar}>
              <span>
                {selectedSlotIds.size} selected
              </span>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={busy}
                onClick={() => void bulkSetSlotsActive(false)}
              >
                Hide selected
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={busy}
                onClick={() => void bulkSetSlotsActive(true)}
              >
                Restore selected
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={busy}
                onClick={() => setSelectedSlotIds(new Set())}
              >
                Clear
              </button>
            </div>
          ) : null}

          {slots.length === 0 ? (
            <p className={styles.setupEmpty}>No time slots yet. Add your first meeting window above.</p>
          ) : (
            <div className={styles.setupCompactList}>
              {slotsByDay.map(([day, daySlots]) => {
                const allSelected = daySlots.every((s) => selectedSlotIds.has(s.id));
                return (
                  <div key={day} className={styles.setupDayGroup}>
                    <div className={styles.setupDayLabelRow}>
                      <p className={styles.setupDayLabel}>{formatSlotDayLabel(day)}</p>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        disabled={busy}
                        onClick={() => selectDaySlots(daySlots, !allSelected)}
                      >
                        {allSelected ? 'Unselect day' : 'Select day'}
                      </button>
                    </div>
                    {daySlots.map((slot) => {
                      const meetingCount = slotMeetingCounts[slot.id] ?? 0;
                      const availabilityCount = slotAvailabilityCounts[slot.id] ?? 0;
                      const slotInUse = meetingCount > 0 || availabilityCount > 0;
                      const editing = editingSlotId === slot.id;
                      return (
                        <div
                          key={slot.id}
                          className={`${styles.setupSlotRow}${slot.is_active ? '' : ` ${styles.setupSlotRowMuted}`}`}
                        >
                          <label className={styles.setupSlotCheck}>
                            <input
                              type="checkbox"
                              checked={selectedSlotIds.has(slot.id)}
                              onChange={() => toggleSlotSelected(slot.id)}
                              disabled={busy}
                            />
                            <span className={styles.visuallyHidden}>Select slot</span>
                          </label>
                          {editing ? (
                            <div className={styles.setupInlineEdit}>
                              <input
                                type="datetime-local"
                                value={editingSlotStart}
                                onChange={(event) => setEditingSlotStart(event.target.value)}
                                aria-label="Slot start"
                              />
                              <input
                                type="datetime-local"
                                value={editingSlotEnd}
                                onChange={(event) => setEditingSlotEnd(event.target.value)}
                                aria-label="Slot end"
                              />
                              <input
                                value={editingSlotLabel}
                                onChange={(event) => setEditingSlotLabel(event.target.value)}
                                placeholder="Label (optional)"
                                aria-label="Slot label"
                              />
                            </div>
                          ) : (
                            <div>
                              <strong>{formatSlotTimeOnly(slot.start_time, slot.end_time)}</strong>
                              {slot.label ? (
                                <div className={styles.setupSlotMeta}>{slot.label}</div>
                              ) : null}
                            </div>
                          )}
                          {!editing ? (
                            <>
                            {meetingCount > 0 ? (
                              <div className={styles.setupSlotMeta}>
                                {meetingCount} scheduled meeting{meetingCount === 1 ? '' : 's'}
                              </div>
                            ) : null}
                            {availabilityCount > 0 ? (
                              <div className={styles.setupSlotMeta}>
                                {availabilityCount} availability response{availabilityCount === 1 ? '' : 's'}
                              </div>
                            ) : null}
                            </>
                          ) : null}
                          <Badge
                            label={slot.is_active ? 'Active' : 'Hidden'}
                            tone={slot.is_active ? 'success' : 'muted'}
                          />
                          <div className={styles.setupRowActions}>
                            {editing ? (
                              <>
                                <button
                                  type="button"
                                  className={styles.btnPrimary}
                                  disabled={busy}
                                  onClick={() => void saveSlotEdit(slot)}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className={styles.btnSecondary}
                                  disabled={busy}
                                  onClick={cancelEditSlot}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={styles.btnSecondary}
                                  disabled={busy || slotInUse}
                                  title={slotInUse ? 'Hide this slot because it is already in use.' : 'Edit slot'}
                                  onClick={() => beginEditSlot(slot)}
                                >
                                  Edit
                                </button>
                                {slotInUse ? (
                                  <button
                                    type="button"
                                    className={styles.btnSecondary}
                                    disabled={busy}
                                    onClick={() =>
                                      void toggleRow('event_matchmaking_time_slots', slot.id, slot.is_active)
                                    }
                                  >
                                    {slot.is_active ? 'Hide' : 'Restore'}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className={styles.btnSecondary}
                                    disabled={busy}
                                    onClick={() => void deleteSlot(slot)}
                                  >
                                    Delete
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className={styles.setupPanel}>
          <div className={styles.setupPanelHeader}>
            <h3>Locations / booth</h3>
            <Badge label={`${locations.length} total`} tone="info" />
          </div>
          <p className={styles.setupPanelHint}>
            Booths or rooms where meetings happen. Attach each booth to a vendor so Approve places
            that vendor there by default. That also links their Solution Provider listing in the app
            (booth location = this name). Capacity = concurrent meetings at that spot.
          </p>

          <div className={styles.setupFormRow}>
            <label className={styles.field}>
              <span>Name</span>
              <input
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder="Booth A1"
              />
            </label>
            <label className={styles.field}>
              <span>Capacity</span>
              <input
                type="number"
                min={1}
                value={locationCapacity}
                onChange={(event) => setLocationCapacity(Number(event.target.value) || 1)}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Vendor</span>
              <select
                value={locationVendorId}
                onChange={(event) => setLocationVendorId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {diaryRows.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendorLabel(vendor)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={busy}
              onClick={() => void addLocation()}
            >
              Add location
            </button>
          </div>

          {locations.length === 0 ? (
            <p className={styles.setupEmpty}>No locations yet. Add at least one booth before approving.</p>
          ) : (
            <div className={styles.setupCompactList}>
              {locations.map((location) => {
                const assigned = location.vendor_submission_id
                  ? vendorById.get(location.vendor_submission_id)
                  : null;
                const meetingCount = locationMeetingCounts[location.id] ?? 0;
                const editing = editingLocationId === location.id;
                return (
                  <div
                    key={location.id}
                    className={`${styles.setupLocationRow}${location.is_active ? '' : ` ${styles.setupSlotRowMuted}`}`}
                  >
                    {editing ? (
                      <div className={styles.setupLocationInlineEdit}>
                        <input
                          value={editingLocationName}
                          onChange={(event) => setEditingLocationName(event.target.value)}
                          placeholder="Location name"
                          aria-label="Location name"
                        />
                        <input
                          type="number"
                          min={1}
                          value={editingLocationCapacity}
                          onChange={(event) =>
                            setEditingLocationCapacity(Number(event.target.value) || 1)
                          }
                          aria-label="Location capacity"
                        />
                      </div>
                    ) : (
                      <div>
                        <strong>{location.name}</strong>
                        <div className={styles.setupSlotMeta}>
                          Capacity {location.capacity} concurrent
                          {assigned ? ` · ${vendorLabel(assigned)}` : ' · No vendor'}
                          {meetingCount > 0
                            ? ` · ${meetingCount} scheduled meeting${meetingCount === 1 ? '' : 's'}`
                            : ''}
                        </div>
                      </div>
                    )}
                    <label className={styles.setupVendorSelect}>
                      <span className={styles.visuallyHidden}>Vendor</span>
                      <select
                        disabled={busy}
                        value={location.vendor_submission_id ?? ''}
                        onChange={(event) =>
                          void assignLocationVendor(location.id, event.target.value)
                        }
                      >
                        <option value="">Unassigned</option>
                        {diaryRows.map((vendor) => (
                          <option key={vendor.id} value={vendor.id}>
                            {vendorLabel(vendor)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Badge
                      label={location.is_active ? 'Active' : 'Hidden'}
                      tone={location.is_active ? 'success' : 'muted'}
                    />
                    <div className={styles.setupRowActions}>
                      {editing ? (
                        <>
                          <button
                            type="button"
                            className={styles.btnPrimary}
                            disabled={busy}
                            onClick={() => void saveLocationEdit(location)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            disabled={busy}
                            onClick={cancelEditLocation}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            disabled={busy || meetingCount > 0}
                            title={
                              meetingCount > 0
                                ? 'Hide this location because it has scheduled meetings.'
                                : 'Edit location'
                            }
                            onClick={() => beginEditLocation(location)}
                          >
                            Edit
                          </button>
                          {meetingCount > 0 || location.vendor_submission_id || location.vendor_booth_id ? (
                            <button
                              type="button"
                              className={styles.btnSecondary}
                              disabled={busy}
                              onClick={() =>
                                void toggleRow('event_matchmaking_locations', location.id, location.is_active)
                              }
                            >
                              {location.is_active ? 'Hide' : 'Restore'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={styles.btnSecondary}
                              disabled={busy}
                              onClick={() => void deleteLocation(location)}
                            >
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className={styles.setupPanel}>
        <div className={styles.setupPanelHeader}>
          <h3>Scheduling rules</h3>
        </div>
        <p className={styles.setupPanelHint}>
          Event-wide defaults (same for every vendor): meeting length, day hours, max meetings per
          person, availability deadline, and whether the schedule is locked. Used when generating
          slots from these settings.
        </p>
        <div className={styles.setupRulesGrid}>
          <label className={styles.field}>
            <span>Meeting length (min)</span>
            <input
              type="number"
              min={5}
              max={180}
              value={settings.default_meeting_minutes}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  default_meeting_minutes: Number(event.target.value) || 30,
                }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Day start</span>
            <select
              value={settings.auto_slot_start_hour}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  auto_slot_start_hour: Number(event.target.value),
                }))
              }
            >
              {DAY_START_HOUR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Day end</span>
            <select
              value={settings.auto_slot_end_hour}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  auto_slot_end_hour: Number(event.target.value),
                }))
              }
            >
              {DAY_END_HOUR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Max meetings</span>
            <input
              type="number"
              min={0}
              value={settings.max_meetings_per_attendee}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  max_meetings_per_attendee: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Availability deadline</span>
            <input
              type="datetime-local"
              value={settings.availability_deadline?.slice(0, 16) ?? ''}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  availability_deadline: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : null,
                }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Schedule status</span>
            <select
              value={settings.schedule_locked ? 'locked' : 'open'}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  schedule_locked: event.target.value === 'locked',
                }))
              }
            >
              <option value="open">Open for scheduling</option>
              <option value="locked">Locked / frozen</option>
            </select>
          </label>
        </div>
        <div>
          <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void saveRules()}>
            {busy ? 'Saving…' : 'Save scheduling rules'}
          </button>
        </div>
      </section>

      <section className={styles.setupPanel}>
        <div className={styles.setupPanelHeader}>
          <h3>Vendor meeting package</h3>
        </div>
        <p className={styles.setupPanelHint}>
          Per vendor, based on what they paid for. Turn meetings off if the package does not include
          matchmaking. Max meetings overrides the event default when set. Meetings / slot = how many
          they can hold at the same time (multi-booth).
        </p>
        {diaryRows.length === 0 ? (
          <p className={styles.setupEmpty}>No vendor registrants loaded yet.</p>
        ) : (
          <div className={`${styles.tableWrap} ${styles.diariesTable}`}>
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Person</th>
                  <th>Meetings</th>
                  <th>Max meetings</th>
                  <th>Meetings / slot</th>
                </tr>
              </thead>
              <tbody>
                {diaryRows.map((row) => {
                  const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || '—';
                  const enabled = row.meetings_enabled !== false;
                  return (
                    <tr key={row.id} className={enabled ? undefined : styles.setupSlotRowMuted}>
                      <td>{row.company_name || '—'}</td>
                      <td>{name}</td>
                      <td>
                        <label className={styles.setupSlotCheck}>
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={busy}
                            onChange={(event) => {
                              void saveVendorPackage(row.id, {
                                meetings_enabled: event.target.checked,
                              });
                            }}
                          />
                          <span>{enabled ? 'On' : 'Off'}</span>
                        </label>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={99}
                          disabled={busy || !enabled}
                          placeholder={`Default ${settings.max_meetings_per_attendee}`}
                          value={
                            maxMeetingDrafts[row.id] !== undefined
                              ? maxMeetingDrafts[row.id]
                              : row.max_meetings === null || row.max_meetings === undefined
                                ? ''
                                : String(row.max_meetings)
                          }
                          onChange={(event) => {
                            setMaxMeetingDrafts((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }));
                          }}
                          onBlur={(event) => {
                            const raw = event.target.value.trim();
                            const value = raw === '' ? null : Math.max(0, Math.floor(Number(raw)) || 0);
                            void saveVendorPackage(row.id, { max_meetings: value }).then(() => {
                              setMaxMeetingDrafts((current) => {
                                const next = { ...current };
                                delete next[row.id];
                                return next;
                              });
                            });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          disabled={busy || !enabled}
                          value={diaryDrafts[row.id] ?? row.concurrent_meetings_per_slot ?? 1}
                          onChange={(event) => {
                            const value = Number(event.target.value) || 1;
                            setDiaryDrafts((current) => ({ ...current, [row.id]: value }));
                          }}
                          onBlur={(event) => {
                            const value = Number(event.target.value) || 1;
                            void saveVendorPackage(row.id, {
                              concurrent_meetings_per_slot: value,
                            }).then(() => {
                              setDiaryDrafts((current) => {
                                const next = { ...current };
                                delete next[row.id];
                                return next;
                              });
                            });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
