import { useEffect, useState, useCallback, useMemo } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Event } from '../lib/types';
import { fetchEventsForSwitcher } from '../lib/fetchAdminEvents';
import styles from './EventContextBar.module.css';

export const ADMIN_EVENTS_REFRESH = 'kbm-admin-events-refresh';

export default function EventContextBar() {
  const navigate = useNavigate();
  const match = useMatch({ path: '/events/:eventId/*', end: false });
  const eventId = match?.params.eventId;

  const [events, setEvents] = useState<Event[]>([]);
  const [currentName, setCurrentName] = useState<string>('');
  const loadEvents = useCallback(async () => {
    try {
      const list = await fetchEventsForSwitcher();
      setEvents(list);
    } catch {
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents, eventId]);

  useEffect(() => {
    const onRefresh = () => loadEvents();
    window.addEventListener(ADMIN_EVENTS_REFRESH, onRefresh);
    return () => window.removeEventListener(ADMIN_EVENTS_REFRESH, onRefresh);
  }, [loadEvents]);

  useEffect(() => {
    if (!eventId) {
      setCurrentName('');
      return;
    }
    const fromList = events.find((e) => e.id === eventId);
    if (fromList) {
      setCurrentName(fromList.name);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('name')
        .eq('id', eventId)
        .maybeSingle();
      if (!cancelled && data) setCurrentName((data as { name: string }).name ?? '');
    })();
    return () => { cancelled = true; };
  }, [eventId, events]);

  const handleSwitch = (nextId: string) => {
    if (!nextId || nextId === eventId) return;
    navigate(`/events/${nextId}`);
  };

  const eventOptions = useMemo(() => {
    if (!eventId) return events;
    if (events.some((e) => e.id === eventId)) return events;
    const stub: Event = {
      id: eventId,
      name: currentName || 'Current event',
      description: null,
      location: null,
      venue: null,
      start_date: '',
      end_date: '',
      theme_color: '',
      event_code: null,
      is_active: true,
      created_at: '',
    };
    return [stub, ...events];
  }, [events, eventId, currentName]);

  if (!eventId) return null;

  return (
    <>
      <div className={styles.wrap}>
        <span className={styles.label}>Event</span>
        <select
          className={styles.select}
          aria-label="Switch event"
          value={eventId}
          onChange={(e) => handleSwitch(e.target.value)}
        >
          {eventOptions.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
              {ev.is_active === false ? ' (disabled)' : ''}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function JoinEventModal({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError('Enter an event code.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        setError('You must be signed in.');
        setBusy(false);
        return;
      }

      const { data: ev, error: qErr } = await supabase
        .from('events')
        .select('id, name')
        .eq('is_active', true)
        .eq('event_code', trimmed)
        .maybeSingle();

      if (qErr) {
        setError(qErr.message);
        setBusy(false);
        return;
      }
      if (!ev) {
        setError('No active event found with that code.');
        setBusy(false);
        return;
      }

      const row = { event_id: (ev as { id: string }).id, user_id: user.id, role: 'attendee' as const };
      const { error: insErr } = await supabase.from('event_members').insert(row);

      if (insErr) {
        const dup =
          insErr.code === '23505' ||
          /unique constraint|duplicate key/i.test(insErr.message ?? '');
        if (!dup) {
          setError(insErr.message ?? 'Could not join this event.');
          setBusy(false);
          return;
        }
      }

      await onJoined();
      window.dispatchEvent(new Event(ADMIN_EVENTS_REFRESH));
      navigate(`/events/${(ev as { id: string }).id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-event-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className={styles.modal}>
        <h2 id="join-event-title">Join another event</h2>
        <p>
          Enter the event code from the organizer. You&apos;ll be added as a member; an existing event admin can
          promote you to admin if you need full admin access for this event.
        </p>
        <input
          className={styles.input}
          type="text"
          autoComplete="off"
          placeholder="e.g. ABC123"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={32}
        />
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.modalActions}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} onClick={handleJoin} disabled={busy}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Standalone button for event list / layout when not inside an event route */
export function JoinEventButton({ onJoined }: { onJoined?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={styles.linkBtn} onClick={() => setOpen(true)}>
        Join with code
      </button>
      {open ? (
        <JoinEventModal
          onClose={() => setOpen(false)}
          onJoined={async () => {
            await onJoined?.();
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
