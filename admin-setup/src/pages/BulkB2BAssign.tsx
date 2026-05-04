import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import {
  notifyMeetingAssigned,
  notifyMeetingReassignedAway,
  notifyMeetingStatusToAttendee,
  notifyMeetingUpdated,
} from '../lib/meetingNotificationPush';
import { refreshSupabaseSessionIfNeeded } from '../lib/refreshSupabaseSession';
import type { Event } from '../lib/types';
import type { VendorBooth } from '../lib/types';
import type { EventRole } from '../lib/types';
import styles from './BulkB2BAssign.module.css';

type MemberOption = { user_id: string; role: EventRole; user?: { id: string; full_name: string; email: string } };

type AssignRow = {
  key: string;
  attendeeId: string;
  startLocal: string;
  endLocal: string;
};

function newRow(): AssignRow {
  return {
    key: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random()}`,
    attendeeId: '',
    startLocal: '',
    endLocal: '',
  };
}

function formatWhenLabel(start: Date): string {
  return start.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSlotRange(startIso: string, endIso: string): string {
  try {
    const s = new Date(startIso);
    const e = new Date(endIso);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return `${startIso} – ${endIso}`;
    return `${s.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })} – ${e.toLocaleTimeString()}`;
  } catch {
    return `${startIso} – ${endIso}`;
  }
}

/** True after the slot end time (organizers often treat the meeting as “past” once it ends). */
function isSlotPast(endIso: string): boolean {
  const t = new Date(endIso).getTime();
  return !isNaN(t) && t < Date.now();
}

/** `datetime-local` value (YYYY-MM-DDTHH:mm) → same format, +minutes (browser local time). */
function addMinutesToDatetimeLocal(startValue: string, minutes: number): string {
  if (!startValue) return '';
  const d = new Date(startValue);
  if (isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** DB ISO timestamp → `datetime-local` string in the browser's local timezone. */
function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type EditDraft = {
  slotId: string;
  boothId: string;
  bookingId: string | null;
  attendeeId: string;
  startLocal: string;
  endLocal: string;
  previousAttendeeId: string | null;
};

type ExistingMeetingRow = {
  slotId: string;
  boothId: string;
  vendorName: string;
  start_time: string;
  end_time: string;
  booking: {
    id: string;
    attendee_id: string;
    status: string;
    full_name: string | null;
    email: string | null;
  } | null;
};

type VendorBoothRow = VendorBooth & {
  contact_user_id?: string | null;
};

export default function BulkB2BAssign() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [booths, setBooths] = useState<VendorBoothRow[]>([]);
  const [selectedBoothId, setSelectedBoothId] = useState('');
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [rows, setRows] = useState<AssignRow[]>(() => [newRow()]);
  const [templateStart, setTemplateStart] = useState('');
  const [templateEnd, setTemplateEnd] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resultSummary, setResultSummary] = useState<{
    created: number;
    failures: { rowIndex: number; message: string }[];
    pushNotes: string[];
  } | null>(null);
  const [existingRows, setExistingRows] = useState<ExistingMeetingRow[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [existingFetchError, setExistingFetchError] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingEditSlotId, setSavingEditSlotId] = useState<string | null>(null);
  const [showAllEventMeetings, setShowAllEventMeetings] = useState(false);

  /** Resolve attendee display without embedding `users` on bookings (RLS often hides other users' profiles). */
  const loadExistingMeetings = useCallback(
    async (memberSource?: MemberOption[]) => {
      const mem = memberSource ?? members;

      if (showAllEventMeetings) {
        if (!eventId || booths.length === 0) {
          setExistingRows([]);
          setExistingFetchError('');
          return;
        }
        setLoadingExisting(true);
        setExistingFetchError('');
        try {
          await refreshSupabaseSessionIfNeeded();
          const boothIds = booths.map((b) => b.id);
          const boothById = new Map(booths.map((b) => [b.id, b]));

          const { data: slotsData, error: slotsErr } = await supabase
            .from('meeting_slots')
            .select('id, booth_id, start_time, end_time')
            .in('booth_id', boothIds)
            .order('start_time', { ascending: true });
          if (slotsErr) throw slotsErr;
          const slotList = (slotsData ?? []) as {
            id: string;
            booth_id: string;
            start_time: string;
            end_time: string;
          }[];
          if (slotList.length === 0) {
            setExistingRows([]);
            return;
          }
          const slotIds = slotList.map((s) => s.id);

          const { data: bookData, error: bookErr } = await supabase
            .from('meeting_bookings')
            .select('id, slot_id, attendee_id, status')
            .in('slot_id', slotIds);
          if (bookErr) throw bookErr;
          const raw = (bookData ?? []) as { id: string; slot_id: string; attendee_id: string; status: string }[];

          const bySlot = new Map<string, ExistingMeetingRow['booking']>();
          for (const b of raw) {
            const memberRow = mem.find((x) => x.user_id === b.attendee_id);
            bySlot.set(b.slot_id, {
              id: b.id,
              attendee_id: b.attendee_id,
              status: b.status,
              full_name: memberRow?.user?.full_name ?? null,
              email: memberRow?.user?.email ?? null,
            });
          }
          setExistingRows(
            slotList.map((slot) => {
              const vb = boothById.get(slot.booth_id);
              return {
                slotId: slot.id,
                boothId: slot.booth_id,
                vendorName: vb?.vendor_name ?? '—',
                start_time: slot.start_time,
                end_time: slot.end_time,
                booking: bySlot.get(slot.id) ?? null,
              };
            })
          );
        } catch (e) {
          setExistingRows([]);
          setExistingFetchError(postgrestErrorMessage(e));
        } finally {
          setLoadingExisting(false);
        }
        return;
      }

      if (!selectedBoothId) {
        setExistingRows([]);
        setExistingFetchError('');
        return;
      }
      const vbSingle = booths.find((b) => b.id === selectedBoothId);
      const vendorLabel = vbSingle?.vendor_name ?? '—';

      setLoadingExisting(true);
      setExistingFetchError('');
      try {
        await refreshSupabaseSessionIfNeeded();

        const { data: slotsData, error: slotsErr } = await supabase
          .from('meeting_slots')
          .select('id, start_time, end_time')
          .eq('booth_id', selectedBoothId)
          .order('start_time', { ascending: true });
        if (slotsErr) throw slotsErr;
        const slotList = (slotsData ?? []) as { id: string; start_time: string; end_time: string }[];
        if (slotList.length === 0) {
          setExistingRows([]);
          return;
        }
        const slotIds = slotList.map((s) => s.id);

        const { data: rpcRows, error: rpcErr } = await supabase.rpc('admin_list_booth_meeting_bookings', {
          p_booth_id: selectedBoothId,
        });

        let raw: { id: string; slot_id: string; attendee_id: string; status: string }[] = [];
        if (!rpcErr && Array.isArray(rpcRows)) {
          raw = (rpcRows as Record<string, unknown>[]).map((row) => ({
            id: String(row.booking_id ?? ''),
            slot_id: String(row.slot_id ?? ''),
            attendee_id: String(row.attendee_id ?? ''),
            status: String(row.status ?? ''),
          }));
        } else {
          const { data: bookData, error: bookErr } = await supabase
            .from('meeting_bookings')
            .select('id, slot_id, attendee_id, status')
            .in('slot_id', slotIds);
          if (bookErr) throw bookErr;
          raw = (bookData ?? []) as { id: string; slot_id: string; attendee_id: string; status: string }[];
        }
        const bySlot = new Map<string, ExistingMeetingRow['booking']>();
        for (const b of raw) {
          const m = mem.find((x) => x.user_id === b.attendee_id);
          bySlot.set(b.slot_id, {
            id: b.id,
            attendee_id: b.attendee_id,
            status: b.status,
            full_name: m?.user?.full_name ?? null,
            email: m?.user?.email ?? null,
          });
        }
        setExistingRows(
          slotList.map((slot) => ({
            slotId: slot.id,
            boothId: selectedBoothId,
            vendorName: vendorLabel,
            start_time: slot.start_time,
            end_time: slot.end_time,
            booking: bySlot.get(slot.id) ?? null,
          }))
        );
      } catch (e) {
        setExistingRows([]);
        setExistingFetchError(postgrestErrorMessage(e));
      } finally {
        setLoadingExisting(false);
      }
    },
    [showAllEventMeetings, eventId, booths, selectedBoothId, members]
  );

  useEffect(() => {
    loadExistingMeetings();
  }, [loadExistingMeetings]);

  useEffect(() => {
    setEditingSlotId(null);
    setEditDraft(null);
  }, [selectedBoothId]);

  useEffect(() => {
    setEditingSlotId(null);
    setEditDraft(null);
  }, [showAllEventMeetings]);

  const load = useCallback(async (): Promise<MemberOption[]> => {
    if (!eventId) return [];
    const { data: eventData } = await supabase.from('events').select('id, name').eq('id', eventId).single();
    setEvent((eventData as Event) ?? null);

    const { data: boothData } = await supabase
      .from('vendor_booths')
      .select('id, event_id, vendor_name, is_active, contact_user_id')
      .eq('event_id', eventId)
      .order('vendor_name');
    const boothList = (boothData as VendorBoothRow[]) ?? [];
    boothList.sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return (a.vendor_name || '').localeCompare(b.vendor_name || '', undefined, { sensitivity: 'base' });
    });
    setBooths(boothList);
    // Do not default to a booth: admin must select each visit (or keep selection if still valid after reload).
    setSelectedBoothId((prev) => {
      if (prev && boothList.some((b) => b.id === prev)) return prev;
      return '';
    });

    const { data: memData } = await supabase
      .from('event_members')
      .select('user_id, role, users!inner(id, full_name, email)')
      .eq('event_id', eventId)
      .order('role');
    const memRows = (memData ?? []) as {
      user_id: string;
      role: string;
      users: { id: string; full_name: string; email: string } | { id: string; full_name: string; email: string }[];
    }[];
    const list: MemberOption[] = memRows.map((r) => {
      const u = Array.isArray(r.users) ? r.users[0] : r.users;
      return { user_id: r.user_id, role: r.role as EventRole, user: u };
    });
    list.sort((a, b) => {
      const na = (a.user?.full_name || a.user?.email || '').toLowerCase();
      const nb = (b.user?.full_name || b.user?.email || '').toLowerCase();
      return na.localeCompare(nb);
    });
    setMembers(list);
    return list;
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, load]);

  const applyTemplateToAll = () => {
    if (!templateStart || !templateEnd) {
      setError('Set both template start and end first.');
      return;
    }
    const a = new Date(templateStart);
    const b = new Date(templateEnd);
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || b <= a) {
      setError('Template: end must be after start.');
      return;
    }
    setError('');
    setRows((prev) => prev.map((r) => ({ ...r, startLocal: templateStart, endLocal: templateEnd })));
  };

  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (key: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  };

  const updateRow = (key: string, patch: Partial<Pick<AssignRow, 'attendeeId' | 'startLocal' | 'endLocal'>>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResultSummary(null);
    if (!eventId || !selectedBoothId) {
      setError('Select a vendor booth.');
      return;
    }
    const booth = booths.find((b) => b.id === selectedBoothId);
    const vendorName = booth?.vendor_name ?? 'Vendor';
    const { count: repCount, error: repErr } = await supabase
      .from('vendor_booth_reps')
      .select('booth_id', { count: 'exact', head: true })
      .eq('booth_id', selectedBoothId);
    if (repErr) {
      setError(`Could not verify vendor reps for this booth: ${repErr.message}`);
      return;
    }
    const hasLinkedVendor = (repCount ?? 0) > 0 || !!booth?.contact_user_id;
    if (!hasLinkedVendor) {
      setError(
        'This booth has no linked vendor representative yet, so vendors cannot see assigned meetings. Open Vendor booth details and set a primary representative or additional reps.'
      );
      return;
    }

    const filled = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.attendeeId && r.startLocal && r.endLocal);
    if (filled.length === 0) {
      setError('Add at least one row with attendee, start, and end.');
      return;
    }

    for (const { r, i } of filled) {
      const start = new Date(r.startLocal);
      const end = new Date(r.endLocal);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        setError(`Row ${i + 1}: invalid date/time.`);
        return;
      }
      if (end <= start) {
        setError(`Row ${i + 1}: end must be after start.`);
        return;
      }
    }

    setSubmitting(true);
    const failures: { rowIndex: number; message: string }[] = [];
    const pushNotes: string[] = [];
    let created = 0;

    await refreshSupabaseSessionIfNeeded();

    for (const { r, i } of filled) {
      const start = new Date(r.startLocal);
      const end = new Date(r.endLocal);
      try {
        const { data: slotRow, error: slotErr } = await supabase
          .from('meeting_slots')
          .insert({
            booth_id: selectedBoothId,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            is_available: true,
          })
          .select('id')
          .single();
        if (slotErr) throw slotErr;
        const slotId = (slotRow as { id: string }).id;

        const { error: bookErr } = await supabase.from('meeting_bookings').insert({
          slot_id: slotId,
          attendee_id: r.attendeeId,
          status: 'confirmed',
        });
        if (bookErr) {
          await supabase.from('meeting_slots').delete().eq('id', slotId);
          throw bookErr;
        }

        const whenLabel = formatWhenLabel(start);
        const { error: nErr, pushError } = await notifyMeetingAssigned(
          r.attendeeId,
          eventId,
          vendorName,
          selectedBoothId,
          whenLabel
        );
        if (nErr) {
          pushNotes.push(`Row ${i + 1}: notification not saved — ${nErr}`);
        } else if (pushError) {
          pushNotes.push(`Row ${i + 1}: ${pushError}`);
        }
        created += 1;
      } catch (err) {
        failures.push({ rowIndex: i + 1, message: postgrestErrorMessage(err) });
      }
    }

    setResultSummary({ created, failures, pushNotes });
    setSubmitting(false);
    await refreshSupabaseSessionIfNeeded();
    const freshMembers = await load();
    await loadExistingMeetings(freshMembers);
  };

  const startEditRow = (row: ExistingMeetingRow) => {
    setError('');
    setEditingSlotId(row.slotId);
    setEditDraft({
      slotId: row.slotId,
      boothId: row.boothId,
      bookingId: row.booking?.id ?? null,
      attendeeId: row.booking?.attendee_id ?? '',
      startLocal: isoToDatetimeLocal(row.start_time),
      endLocal: isoToDatetimeLocal(row.end_time),
      previousAttendeeId: row.booking?.attendee_id ?? null,
    });
  };

  const cancelEditRow = () => {
    setEditingSlotId(null);
    setEditDraft(null);
  };

  const handleSaveEdit = async () => {
    if (!editDraft || !eventId) return;
    const boothId = editDraft.boothId || selectedBoothId;
    if (!boothId) return;
    setError('');

    const { slotId, bookingId, attendeeId, startLocal, endLocal, previousAttendeeId } = editDraft;
    const start = new Date(startLocal);
    const end = new Date(endLocal);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setError('Invalid start or end time.');
      return;
    }
    if (end <= start) {
      setError('End must be after start.');
      return;
    }
    if (bookingId && !attendeeId) {
      setError('Select an attendee for this meeting.');
      return;
    }

    setSavingEditSlotId(slotId);
    try {
      await refreshSupabaseSessionIfNeeded();

      const { error: slotErr } = await supabase
        .from('meeting_slots')
        .update({
          start_time: start.toISOString(),
          end_time: end.toISOString(),
        })
        .eq('id', slotId);
      if (slotErr) throw slotErr;

      if (bookingId) {
        const { error: bookErr } = await supabase
          .from('meeting_bookings')
          .update({ attendee_id: attendeeId })
          .eq('id', bookingId);
        if (bookErr) throw bookErr;
      }

      const boothMeta = booths.find((b) => b.id === boothId);
      const vendorName = boothMeta?.vendor_name ?? 'Vendor';
      const whenLabel = formatWhenLabel(start);

      let notifyWarn = '';
      if (bookingId && attendeeId) {
        const prev = previousAttendeeId;
        if (prev && prev !== attendeeId) {
          const parts: string[] = [];
          const away = await notifyMeetingReassignedAway(prev, eventId, vendorName, boothId);
          if (away.error) parts.push(`Previous attendee: ${away.error}`);
          else if (away.pushError) parts.push(`Previous attendee push: ${away.pushError}`);
          const assigned = await notifyMeetingAssigned(attendeeId, eventId, vendorName, boothId, whenLabel);
          if (assigned.error) parts.push(`New attendee: ${assigned.error}`);
          else if (assigned.pushError) parts.push(`New attendee push: ${assigned.pushError}`);
          notifyWarn = parts.join(' ');
        } else {
          const upd = await notifyMeetingUpdated(attendeeId, eventId, vendorName, boothId, whenLabel);
          if (upd.error) notifyWarn = upd.error;
          else if (upd.pushError) notifyWarn = `Push: ${upd.pushError}`;
        }
      }
      if (notifyWarn) setError(`Meeting saved. ${notifyWarn}`);

      cancelEditRow();
      await loadExistingMeetings();
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setSavingEditSlotId(null);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    if (!window.confirm('Cancel this meeting? The time slot will remain unless you remove it elsewhere.')) return;
    setError('');
    setCancellingId(bookingId);
    try {
      const row = existingRows.find((r) => r.booking?.id === bookingId);
      const attendeeId = row?.booking?.attendee_id;
      const boothId = row?.boothId ?? selectedBoothId;
      const { error: err } = await supabase.from('meeting_bookings').update({ status: 'cancelled' }).eq('id', bookingId);
      if (err) throw err;
      if (eventId && boothId && attendeeId) {
        const vendorName = row?.vendorName ?? selectedBooth?.vendor_name ?? 'Vendor';
        const n = await notifyMeetingStatusToAttendee(attendeeId, eventId, vendorName, boothId, 'cancelled');
        if (n.error) {
          setError(`Meeting cancelled, but in-app notification failed: ${n.error}`);
        } else if (n.pushError) {
          setError(`Meeting cancelled. Push note: ${n.pushError}`);
        }
      }
      await loadExistingMeetings();
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setCancellingId(null);
    }
  };

  /** Deletes the slot; booking rows cascade away (incl. cancelled). */
  const handleDeleteSlot = async (slotId: string) => {
    if (
      !window.confirm(
        'Delete this time slot permanently? Any booking on it (including cancelled) will be removed. This cannot be undone.'
      )
    ) {
      return;
    }
    setError('');
    setDeletingSlotId(slotId);
    try {
      await refreshSupabaseSessionIfNeeded();
      const row = existingRows.find((r) => r.slotId === slotId);
      const boothId = row?.boothId ?? selectedBoothId;
      const vendorName = row?.vendorName ?? selectedBooth?.vendor_name ?? 'Vendor';
      let pushNote: string | undefined;
      if (eventId && boothId && row?.booking && row.booking.status !== 'cancelled') {
        const n = await notifyMeetingStatusToAttendee(
          row.booking.attendee_id,
          eventId,
          vendorName,
          boothId,
          'slot_removed'
        );
        if (n.error) {
          setError(`Could not save in-app notification (${n.error}). Slot was not deleted.`);
          return;
        }
        if (n.pushError) pushNote = n.pushError;
      }
      const { error: err } = await supabase.from('meeting_slots').delete().eq('id', slotId);
      if (err) throw err;
      await loadExistingMeetings();
      if (pushNote) {
        setError(`Slot removed. In-app notification saved; push: ${pushNote}`);
      }
    } catch (e) {
      setError(postgrestErrorMessage(e));
    } finally {
      setDeletingSlotId(null);
    }
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;

  const selectedBooth = booths.find((b) => b.id === selectedBoothId);

  const activeExistingRows = existingRows.filter((row) => !row.booking || row.booking.status !== 'cancelled');
  const cancelledExistingRows = existingRows.filter((row) => row.booking?.status === 'cancelled');

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
      </div>
      <h1>Meetings — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>
        <strong>Pick a vendor booth</strong> to load that booth’s scheduled meetings (the list is per booth, not for the
        whole event). Then add meetings below. When you set a <strong>Start</strong> time, <strong>End</strong> fills with
        30 minutes later (you can edit it). After you save, the full list for that booth appears at the bottom
        (times, assigned members, cancel). Names come from the event member list so they show even when profile RLS is
        restricted. Rows with any empty field are skipped when creating. Inactive booths are included in the list so you
        can still open meetings that were created before a booth was deactivated. Use <strong>Show all meetings</strong>{' '}
        below to list every booth’s slots in one table.
      </p>

      <div className={styles.fieldBlock}>
        <label htmlFor="bulk-booth">Vendor booth</label>
        <select
          id="bulk-booth"
          value={selectedBoothId}
          onChange={(e) => setSelectedBoothId(e.target.value)}
        >
          <option value="">— Select booth —</option>
          {booths.map((b) => (
            <option key={b.id} value={b.id}>
              {b.vendor_name}
              {!b.is_active ? ' (inactive)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.viewModeBar}>
        <span className={styles.viewModeLabel}>Scheduled meetings list</span>
        <div className={styles.viewModeButtons}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost} ${showAllEventMeetings ? styles.btnPressed : ''}`}
            aria-pressed={showAllEventMeetings}
            onClick={() => setShowAllEventMeetings(true)}
            disabled={booths.length === 0}
          >
            Show all meetings
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost} ${!showAllEventMeetings ? styles.btnPressed : ''}`}
            aria-pressed={!showAllEventMeetings}
            onClick={() => setShowAllEventMeetings(false)}
          >
            This booth only
          </button>
        </div>
      </div>

      {!selectedBoothId && !showAllEventMeetings && (
        <p className={styles.boothCallout} role="status">
          Select a vendor booth above to see existing time slots and manage them. If you expect meetings but see none,
          choose the booth that was used when those meetings were scheduled (or an inactive booth if that vendor was
          turned off). Or use <strong>Show all meetings</strong> to load every booth at once.
        </p>
      )}

      <h2 className={styles.sectionTitle}>Add new meetings</h2>

      <form onSubmit={handleSubmit}>
        <div className={styles.templateCard}>
          <h2>Same time for every row</h2>
          <p className={styles.hint} style={{ marginBottom: 12 }}>
            Optional: pick a start time — end time fills in 30 minutes later automatically (you can change it). Apply to all
            rows, then adjust any cell.
          </p>
          <div className={styles.templateRow}>
            <label>
              Start
              <input
                type="datetime-local"
                value={templateStart}
                onChange={(e) => {
                  const v = e.target.value;
                  setTemplateStart(v);
                  setTemplateEnd(v ? addMinutesToDatetimeLocal(v, 30) : '');
                }}
              />
            </label>
            <label>
              End
              <input type="datetime-local" value={templateEnd} onChange={(e) => setTemplateEnd(e.target.value)} />
            </label>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={applyTemplateToAll}>
              Apply to all rows
            </button>
          </div>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.toolbar}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={addRow}>
            Add row
          </button>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Attendee</th>
                <th>Start</th>
                <th>End</th>
                <th aria-label="Remove row" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.key}>
                  <td>{idx + 1}</td>
                  <td>
                    <select
                      value={row.attendeeId}
                      onChange={(e) => updateRow(row.key, { attendeeId: e.target.value })}
                      aria-label={`Attendee row ${idx + 1}`}
                    >
                      <option value="">— Member —</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.user?.full_name ?? m.user?.email ?? m.user_id}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="datetime-local"
                      value={row.startLocal}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateRow(row.key, {
                          startLocal: v,
                          endLocal: v ? addMinutesToDatetimeLocal(v, 30) : '',
                        });
                      }}
                      aria-label={`Start row ${idx + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      type="datetime-local"
                      value={row.endLocal}
                      onChange={(e) => updateRow(row.key, { endLocal: e.target.value })}
                      aria-label={`End row ${idx + 1}`}
                    />
                  </td>
                  <td className={styles.rowActions}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnDanger}`}
                      onClick={() => removeRow(row.key)}
                      disabled={rows.length <= 1}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={submitting || !selectedBoothId}>
          {submitting ? 'Creating…' : 'Create meetings & notify'}
        </button>
      </form>

      {resultSummary && (
        <div className={styles.results}>
          <h3>Result</h3>
          <p>
            <strong>{resultSummary.created}</strong> meeting{resultSummary.created === 1 ? '' : 's'} created
            {selectedBooth ? ` for ${selectedBooth.vendor_name}` : ''}.
          </p>
          {resultSummary.failures.length > 0 && (
            <>
              <p className={styles.error}>Failures</p>
              <ul>
                {resultSummary.failures.map((f) => (
                  <li key={f.rowIndex}>
                    Row {f.rowIndex}: {f.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {resultSummary.pushNotes.length > 0 && (
            <>
              <p className={styles.warn}>Notification / push notes</p>
              <ul>
                {resultSummary.pushNotes.map((n, idx) => (
                  <li key={idx}>{n}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {(showAllEventMeetings || selectedBoothId) && (
        <>
          <h2 className={styles.sectionTitle}>
            {showAllEventMeetings
              ? 'Scheduled meetings — all vendor booths'
              : `Scheduled meetings — ${selectedBooth?.vendor_name ?? 'this booth'}`}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost} ${styles.inlineRefresh}`}
              onClick={() => loadExistingMeetings()}
              disabled={loadingExisting}
            >
              {loadingExisting ? 'Refreshing…' : 'Refresh'}
            </button>
          </h2>
          <p className={styles.sectionHint}>
            {showAllEventMeetings
              ? 'Every time slot across booths for this event, sorted by start time. Creating new meetings still uses the booth selected above.'
              : 'Every time slot for this booth. Assigned rows show who is booked; open slots have no attendee yet.'}{' '}
            Use <strong>Edit</strong> to change time or reassign an attendee for upcoming slots (notifications are sent when you save).
            Use <strong>Cancel meeting</strong> only before the slot ends. Past meetings show as <strong>Ended</strong> (no cancel). Cancelled meetings appear in a separate section below.
          </p>
          {existingFetchError ? <p className={styles.error}>{existingFetchError}</p> : null}
          {loadingExisting && existingRows.length === 0 && !existingFetchError ? (
            <p className={styles.hint}>Loading…</p>
          ) : existingRows.length === 0 && !existingFetchError ? (
            <p className={styles.hint}>
              {showAllEventMeetings
                ? 'No time slots for any booth yet. Use the form above (pick a booth first) to create meetings.'
                : 'No time slots yet for this booth. Use the form above to create meetings.'}
            </p>
          ) : !existingFetchError ? (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {showAllEventMeetings ? <th>Booth</th> : null}
                      <th>When</th>
                      <th>Attendee</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {activeExistingRows.map((row) => {
                      const isEditing = editingSlotId === row.slotId && editDraft?.slotId === row.slotId;
                      const past = isSlotPast(row.end_time);
                      const canEditSlot = !past;
                      return (
                        <tr key={row.slotId} className={past ? styles.rowPast : undefined}>
                          {isEditing && editDraft ? (
                            <>
                              {showAllEventMeetings ? <td>{row.vendorName}</td> : null}
                              <td className={styles.editWhenCell}>
                                <input
                                  type="datetime-local"
                                  value={editDraft.startLocal}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setEditDraft((d) =>
                                      d ? { ...d, startLocal: v, endLocal: v ? addMinutesToDatetimeLocal(v, 30) : d.endLocal } : d
                                    );
                                  }}
                                  aria-label="Edit start"
                                />
                                <span className={styles.editTimeSep}>–</span>
                                <input
                                  type="datetime-local"
                                  value={editDraft.endLocal}
                                  onChange={(e) =>
                                    setEditDraft((d) => (d ? { ...d, endLocal: e.target.value } : d))
                                  }
                                  aria-label="Edit end"
                                />
                              </td>
                              <td>
                                {editDraft.bookingId ? (
                                  <select
                                    value={editDraft.attendeeId}
                                    onChange={(e) =>
                                      setEditDraft((d) => (d ? { ...d, attendeeId: e.target.value } : d))
                                    }
                                    aria-label="Edit attendee"
                                  >
                                    <option value="">— Member —</option>
                                    {members.map((m) => (
                                      <option key={m.user_id} value={m.user_id}>
                                        {m.user?.full_name ?? m.user?.email ?? m.user_id}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className={styles.mutedCell}>— Open slot (time only) —</span>
                                )}
                              </td>
                              <td>
                                {past && row.booking ? <span className={styles.pastBadge}>Past · </span> : null}
                                {row.booking?.status ?? '—'}
                              </td>
                              <td className={styles.rowActions}>
                                <div className={styles.actionCluster}>
                                  <button
                                    type="button"
                                    className={`${styles.btn} ${styles.btnGhost}`}
                                    disabled={savingEditSlotId === row.slotId}
                                    onClick={handleSaveEdit}
                                  >
                                    {savingEditSlotId === row.slotId ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.btn} ${styles.btnGhost}`}
                                    disabled={savingEditSlotId === row.slotId}
                                    onClick={cancelEditRow}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              {showAllEventMeetings ? <td>{row.vendorName}</td> : null}
                              <td>{formatSlotRange(row.start_time, row.end_time)}</td>
                              <td>
                                {row.booking ? (
                                  <>
                                    {row.booking.full_name || row.booking.email || row.booking.attendee_id}
                                    {row.booking.email && row.booking.full_name ? (
                                      <span className={styles.mutedCell}> · {row.booking.email}</span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className={styles.mutedCell}>— No one assigned —</span>
                                )}
                              </td>
                              <td>
                                {past && row.booking ? <span className={styles.pastBadge}>Past · </span> : null}
                                {row.booking ? row.booking.status : '—'}
                              </td>
                              <td className={styles.rowActions}>
                                <div className={styles.actionCluster}>
                                  {canEditSlot ? (
                                    <button
                                      type="button"
                                      className={`${styles.btn} ${styles.btnGhost}`}
                                      disabled={!!savingEditSlotId || !!cancellingId || !!deletingSlotId}
                                      onClick={() => startEditRow(row)}
                                    >
                                      Edit
                                    </button>
                                  ) : null}
                                  {row.booking ? (
                                    past ? (
                                      <span className={styles.actionEnded}>Ended</span>
                                    ) : (
                                      <button
                                        type="button"
                                        className={`${styles.btn} ${styles.btnDanger}`}
                                        disabled={cancellingId === row.booking.id || !!savingEditSlotId}
                                        onClick={() => handleCancelBooking(row.booking!.id)}
                                      >
                                        {cancellingId === row.booking.id ? '…' : 'Cancel meeting'}
                                      </button>
                                    )
                                  ) : (
                                    <button
                                      type="button"
                                      className={`${styles.btn} ${styles.btnDanger}`}
                                      disabled={deletingSlotId === row.slotId || !!savingEditSlotId}
                                      onClick={() => handleDeleteSlot(row.slotId)}
                                    >
                                      {deletingSlotId === row.slotId ? '…' : 'Delete slot'}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {cancelledExistingRows.length > 0 ? (
                <>
                  <h3 className={styles.cancelledSectionTitle}>Cancelled meetings</h3>
                  <p className={styles.sectionHint}>
                    These time slots still exist; only the booking was cancelled. Use Delete to remove the slot and
                    record permanently.
                  </p>
                  <div className={styles.tableWrap}>
                    <table className={`${styles.table} ${styles.tableCancelled}`}>
                      <thead>
                        <tr>
                          {showAllEventMeetings ? <th>Booth</th> : null}
                          <th>When</th>
                          <th>Attendee</th>
                          <th>Status</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {cancelledExistingRows.map((row) => (
                          <tr key={row.slotId} className={styles.rowCancelled}>
                            {showAllEventMeetings ? <td>{row.vendorName}</td> : null}
                            <td>{formatSlotRange(row.start_time, row.end_time)}</td>
                            <td>
                              {row.booking ? (
                                <>
                                  {row.booking.full_name || row.booking.email || row.booking.attendee_id}
                                  {row.booking.email && row.booking.full_name ? (
                                    <span className={styles.mutedCell}> · {row.booking.email}</span>
                                  ) : null}
                                </>
                              ) : null}
                            </td>
                            <td>cancelled</td>
                            <td className={styles.rowActions}>
                              <button
                                type="button"
                                className={`${styles.btn} ${styles.btnDanger}`}
                                disabled={deletingSlotId === row.slotId}
                                onClick={() => handleDeleteSlot(row.slotId)}
                              >
                                {deletingSlotId === row.slotId ? '…' : 'Delete'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </>
      )}

      {booths.length === 0 && (
        <p className={styles.hint}>
          No active vendor booths. Add booths under <Link to={`/events/${eventId}/vendor-booths`}>Vendor booths</Link> first.
        </p>
      )}
    </div>
  );
}
