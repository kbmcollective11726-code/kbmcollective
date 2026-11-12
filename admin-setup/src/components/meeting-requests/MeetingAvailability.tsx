import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { formatB2BSlotRangeWallClock } from '../../lib/b2bEventTime';
import { postgrestErrorMessage } from '../../lib/postgrestErrorMessage';
import type {
  PortalRole,
  RegistrantPortalContext,
} from '../../lib/registrantPortal';
import { supabase } from '../../lib/supabase';
import type {
  EventMatchmakingAvailability,
  EventMatchmakingTimeSlot,
} from '../../lib/types';
import styles from '../../pages/delegate-portal/DelegatePortal.module.css';

interface Props {
  role: PortalRole;
}

export default function MeetingAvailability({ role }: Props) {
  const { event, settings, submission } = useOutletContext<RegistrantPortalContext>();
  const [slots, setSlots] = useState<EventMatchmakingTimeSlot[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const deadlinePassed = useMemo(() => {
    if (!settings.availability_deadline) return false;
    return Date.now() > new Date(settings.availability_deadline).getTime();
  }, [settings.availability_deadline]);
  const readOnly = settings.schedule_locked || deadlinePassed;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [slotResult, availabilityResult] = await Promise.all([
          supabase
            .from('event_matchmaking_time_slots')
            .select('*')
            .eq('event_id', event.id)
            .eq('is_active', true)
            .order('start_time', { ascending: true }),
          supabase
            .from('event_matchmaking_availability')
            .select('event_id, submission_id, time_slot_id, is_available, updated_at')
            .eq('submission_id', submission.id)
            .eq('is_available', true),
        ]);
        if (slotResult.error) throw slotResult.error;
        if (availabilityResult.error) throw availabilityResult.error;
        if (cancelled) return;
        setSlots((slotResult.data as EventMatchmakingTimeSlot[]) ?? []);
        setSelectedIds(
          new Set(
            ((availabilityResult.data as EventMatchmakingAvailability[]) ?? [])
              .map((row) => row.time_slot_id),
          ),
        );
      } catch (cause) {
        if (!cancelled) {
          setError(postgrestErrorMessage(cause) || 'Could not load meeting availability');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event.id, submission.id]);

  const toggleSlot = (slotId: string) => {
    if (readOnly) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
    setSuccess('');
  };

  const save = async () => {
    if (readOnly) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { data, error: saveError } = await supabase.rpc(
        'set_my_matchmaking_availability',
        {
          p_submission_id: submission.id,
          p_time_slot_ids: [...selectedIds],
        },
      );
      if (saveError) throw saveError;
      const count = typeof data === 'number' ? data : selectedIds.size;
      setSuccess(
        count === 0
          ? 'Availability cleared. The organizer cannot schedule a meeting until you select a time.'
          : `${count} available time ${count === 1 ? 'slot' : 'slots'} saved.`,
      );
    } catch (cause) {
      setError(postgrestErrorMessage(cause) || 'Could not save availability');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading meeting times…</div>;

  const roleLabel = role === 'vendor' ? 'vendor representative' : 'delegate';

  if (!submission.profile_complete || !submission.matching_opt_in) {
    return (
      <section className={styles.card}>
        <h1>1-on-1 availability</h1>
        <p>
          Complete your registration profile and opt in to matchmaking before
          selecting meeting times.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h1>1-on-1 availability</h1>
      <p>
        Select every time you can meet. The organizer will use these choices when
        creating your {roleLabel} meeting schedule.
      </p>
      <p>
        Meeting limit: <strong>{settings.max_meetings_per_attendee}</strong>
        {settings.availability_deadline ? (
          <> · Availability deadline: <strong>{new Date(settings.availability_deadline).toLocaleString()}</strong></>
        ) : null}
      </p>

      {settings.schedule_locked ? (
        <p className={styles.success}>The schedule is locked. Your saved availability is read-only.</p>
      ) : deadlinePassed ? (
        <p className={styles.error}>The availability deadline has passed. Contact the organizer to request a change.</p>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {success ? <p className={styles.success}>{success}</p> : null}

      {slots.length === 0 ? (
        <p>No meeting times have been released yet. Please check back later.</p>
      ) : (
        <>
          {!readOnly ? (
            <div className={styles.saveFooter}>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set(slots.map((slot) => slot.id)))}
              >
                Select all
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())}>
                Clear all
              </button>
              <span>{selectedIds.size} selected</span>
            </div>
          ) : null}
          <div className={styles.tableScroll}>
            <table className={styles.listTable}>
              <thead>
                <tr>
                  <th>Available</th>
                  <th>Date and time</th>
                  <th>Session</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => (
                  <tr key={slot.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(slot.id)}
                        disabled={readOnly}
                        onChange={() => toggleSlot(slot.id)}
                        aria-label={`Available for ${formatB2BSlotRangeWallClock(slot.start_time, slot.end_time)}`}
                      />
                    </td>
                    <td>{formatB2BSlotRangeWallClock(slot.start_time, slot.end_time)}</td>
                    <td>{slot.label || '1-on-1 meetings'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!readOnly && slots.length > 0 ? (
        <div className={styles.saveFooter}>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save availability'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
