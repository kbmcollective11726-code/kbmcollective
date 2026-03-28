import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import type { VendorBooth, MeetingSlot, MeetingBookingRow } from '../lib/types';
import type { EventRole } from '../lib/types';

type MemberOption = { user_id: string; role: EventRole; user?: { id: string; full_name: string; email: string } };
import styles from './Meetings.module.css';

export default function Meetings() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [booths, setBooths] = useState<VendorBooth[]>([]);
  const [selectedBoothId, setSelectedBoothId] = useState<string>('');
  const [slots, setSlots] = useState<(MeetingSlot & { bookings?: MeetingBookingRow[] })[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [newSlotStart, setNewSlotStart] = useState('');
  const [newSlotEnd, setNewSlotEnd] = useState('');
  const [addingSlot, setAddingSlot] = useState(false);
  const [error, setError] = useState('');

  const loadBooths = async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from('vendor_booths')
      .select('id, event_id, vendor_name, description, is_active')
      .eq('event_id', eventId)
      .order('vendor_name');
    const boothList = (data as VendorBooth[]) ?? [];
    setBooths(boothList);
    const firstBooth = boothList[0];
    if (firstBooth && !selectedBoothId) setSelectedBoothId(firstBooth.id);
  };

  const loadSlotsAndBookings = async () => {
    if (!eventId || !selectedBoothId) {
      setSlots([]);
      return;
    }
    const { data: slotsData, error: slotsErr } = await supabase
      .from('meeting_slots')
      .select('id, booth_id, start_time, end_time, is_available')
      .eq('booth_id', selectedBoothId)
      .order('start_time');
    if (slotsErr) {
      setSlots([]);
      return;
    }
    const slotList = (slotsData as MeetingSlot[]) ?? [];
    if (slotList.length === 0) {
      setSlots([]);
      return;
    }
    const slotIds = slotList.map((s) => s.id);
    const { data: bookingsData } = await supabase
      .from('meeting_bookings')
      .select('id, slot_id, attendee_id, status, notes, created_at, users(full_name, email)')
      .in('slot_id', slotIds)
      .neq('status', 'cancelled');
    const bookings: MeetingBookingRow[] = (bookingsData ?? []).map((b: Record<string, unknown>) => ({
      id: b.id as string,
      slot_id: b.slot_id as string,
      attendee_id: b.attendee_id as string,
      status: b.status as string,
      notes: b.notes as string | null,
      created_at: b.created_at as string,
      users: Array.isArray(b.users) ? b.users[0] : b.users,
    }));
    const bySlot: Record<string, MeetingBookingRow[]> = {};
    slotIds.forEach((id) => (bySlot[id] = []));
    bookings.forEach((b) => {
      const slotId = b.slot_id;
      if (bySlot[slotId]) bySlot[slotId].push(b);
    });
    setSlots(slotList.map((s) => ({ ...s, bookings: bySlot[s.id] ?? [] })));
  };

  const loadMembers = async () => {
    if (!eventId) return;
    const { data } = await supabase
      .from('event_members')
      .select('user_id, role, users!inner(id, full_name, email)')
      .eq('event_id', eventId)
      .order('role');
    const rows = (data ?? []) as { user_id: string; role: string; users: { id: string; full_name: string; email: string } | { id: string; full_name: string; email: string }[] }[];
    setMembers(
      rows.map((r) => {
        const u = Array.isArray(r.users) ? r.users[0] : r.users;
        return { user_id: r.user_id, role: r.role as EventRole, user: u };
      })
    );
  };

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: eventData } = await supabase.from('events').select('id, name').eq('id', eventId).single();
        if (eventData && !cancelled) setEvent(eventData as Event);
        await loadBooths();
        await loadMembers();
      } catch {
        if (!cancelled) setBooths([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  useEffect(() => {
    if (!selectedBoothId) {
      setSlots([]);
      return;
    }
    loadSlotsAndBookings();
  }, [eventId, selectedBoothId]);

  const handleAssign = async (slotId: string, attendeeId: string) => {
    if (!attendeeId) return;
    setError('');
    setAssigning(slotId);
    try {
      const { error: err } = await supabase.from('meeting_bookings').insert({
        slot_id: slotId,
        attendee_id: attendeeId,
        status: 'confirmed',
      });
      if (err) throw err;
      await loadSlotsAndBookings();
    } catch (e: unknown) {
      const msg = (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string')
        ? (e as { message: string }).message
        : 'Failed to assign';
      setError(msg);
    } finally {
      setAssigning(null);
    }
  };

  const handleCancel = async (bookingId: string) => {
    setError('');
    setCancelling(bookingId);
    try {
      const { error: err } = await supabase
        .from('meeting_bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId);
      if (err) throw err;
      await loadSlotsAndBookings();
    } catch (e: unknown) {
      const msg = (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string')
        ? (e as { message: string }).message
        : 'Failed to cancel';
      setError(msg);
    } finally {
      setCancelling(null);
    }
  };

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBoothId || !newSlotStart || !newSlotEnd) return;
    setError('');
    setAddingSlot(true);
    try {
      const start = new Date(newSlotStart);
      const end = new Date(newSlotEnd);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
        setError('Invalid start/end time');
        setAddingSlot(false);
        return;
      }
      const { error: err } = await supabase.from('meeting_slots').insert({
        booth_id: selectedBoothId,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        is_available: true,
      });
      if (err) throw err;
      setNewSlotStart('');
      setNewSlotEnd('');
      setAddSlotOpen(false);
      await loadSlotsAndBookings();
    } catch (e: unknown) {
      const msg = (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string')
        ? (e as { message: string }).message
        : 'Failed to add slot';
      setError(msg);
    } finally {
      setAddingSlot(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;

  const selectedBooth = booths.find((b) => b.id === selectedBoothId);

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>← Event</Link>
      </div>
      <h1>Meetings — {event?.name ?? 'Event'}</h1>
      <p className={styles.hint}>
        Manage B2B meeting slots and assign attendees. Select a booth, then add slots or assign attendees to slots.
      </p>

      <div className={styles.boothSelect}>
        <label>Vendor booth</label>
        <select
          value={selectedBoothId}
          onChange={(e) => setSelectedBoothId(e.target.value)}
        >
          <option value="">— Select booth —</option>
          {booths.map((b) => (
            <option key={b.id} value={b.id}>{b.vendor_name}</option>
          ))}
        </select>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {selectedBoothId && (
        <>
          <div className={styles.toolbar}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setAddSlotOpen(true)}>
              Add slot
            </button>
          </div>

          <h2 className={styles.listTitle}>
            Slots — {selectedBooth?.vendor_name ?? 'Booth'} ({slots.length})
          </h2>
          {slots.length === 0 ? (
            <p className={styles.empty}>No slots. Add a slot to create meeting times for this booth.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Start – End</th>
                    <th>Assigned</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => {
                    const booking = slot.bookings?.[0];
                    return (
                      <tr key={slot.id}>
                        <td>
                          {new Date(slot.start_time).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                          {' – '}
                          {new Date(slot.end_time).toLocaleTimeString()}
                        </td>
                        <td>
                          {booking ? (
                            (Array.isArray(booking.users) ? booking.users[0] : booking.users)?.full_name ??
                            (Array.isArray(booking.users) ? booking.users[0] : booking.users)?.email ??
                            booking.attendee_id
                          ) : '—'}
                        </td>
                        <td className={styles.assignCell}>
                          {booking ? (
                            <button
                              type="button"
                              className={`${styles.btn} ${styles.btnDanger}`}
                              disabled={cancelling === booking.id}
                              onClick={() => handleCancel(booking.id)}
                            >
                              {cancelling === booking.id ? '…' : 'Cancel'}
                            </button>
                          ) : (
                            <>
                              <select
                                value=""
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v) handleAssign(slot.id, v);
                                }}
                                disabled={!!assigning}
                              >
                                <option value="">Assign attendee…</option>
                                {members.map((m) => (
                                  <option key={m.user_id} value={m.user_id}>
                                    {m.user?.full_name ?? m.user?.email ?? m.user_id}
                                  </option>
                                ))}
                              </select>
                              {assigning === slot.id && <span>Assigning…</span>}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {booths.length === 0 && (
        <p className={styles.empty}>
          No vendor booths for this event. Add booths under <strong>Vendor booths (B2B)</strong> on the event home page, then return here to add slots and assign attendees.
        </p>
      )}

      {addSlotOpen && (
        <div className={styles.modalOverlay} onClick={() => setAddSlotOpen(false)} role="dialog" aria-modal="true">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>Add meeting slot</h2>
              <button type="button" className={styles.modalClose} onClick={() => setAddSlotOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className={styles.modalScroll}>
              <p className={styles.modalPickerHint}>
                <strong>Tip:</strong> Chrome and Edge often don’t show an “OK” on the calendar — pick your date and time,
                then <strong>click outside</strong> the calendar (or press <kbd>Esc</kbd>) to close it. Your choice is saved
                automatically.
              </p>
              <p className={styles.modalPickerHintSecondary}>
                <strong>Cancel</strong> and <strong>Add slot</strong> are on <em>this dialog</em> at the bottom — not inside
                the calendar popup. Close the calendar first, then scroll this window if needed to see them.
              </p>
              <form id="add-meeting-slot-form" onSubmit={handleAddSlot} className={styles.modalBody}>
                <label>Start (date & time)</label>
                <input
                  type="datetime-local"
                  value={newSlotStart}
                  onChange={(e) => setNewSlotStart(e.target.value)}
                  required
                />
                <label>End (date & time)</label>
                <input
                  type="datetime-local"
                  value={newSlotEnd}
                  onChange={(e) => setNewSlotEnd(e.target.value)}
                  required
                />
              </form>
            </div>
            <div className={styles.modalFooter}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setAddSlotOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                form="add-meeting-slot-form"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={addingSlot}
              >
                {addingSlot ? 'Adding…' : 'Add slot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
