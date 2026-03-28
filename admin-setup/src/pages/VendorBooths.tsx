import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { VendorBooth } from '../lib/types';
import styles from './VendorBooths.module.css';

export default function VendorBooths() {
  const { eventId } = useParams<{ eventId: string }>();
  const [booths, setBooths] = useState<VendorBooth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchBooths = useCallback(async () => {
    if (!eventId) return;
    setError('');
    try {
      const { data, error } = await supabase
        .from('vendor_booths')
        .select('id, event_id, vendor_name, description, logo_url, booth_location, contact_user_id, website, is_active, created_at')
        .eq('event_id', eventId)
        .order('vendor_name');
      if (error) throw error;
      setBooths((data as VendorBooth[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load booths');
      setBooths([]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    setLoading(true);
    fetchBooths();
  }, [fetchBooths]);

  if (!eventId) return <div className={styles.error}>Missing event</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
        <h1>Vendor booths (B2B)</h1>
        <p className={styles.hint}>
          Add booths here, then use <strong>Meetings</strong> to create time slots and assign attendees — same as in the mobile app.
        </p>
        <Link to={`/events/${eventId}/vendor-booths/new`} className={styles.addBtn}>
          <span className={styles.addIcon}>+</span>
          Add vendor booth
        </Link>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      {loading ? (
        <div className={styles.loading}>Loading booths…</div>
      ) : booths.length === 0 ? (
        <div className={styles.empty}>
          <p>No vendor booths yet.</p>
          <p className={styles.emptySub}>
            Tap &quot;Add vendor booth&quot; to add one, then add meeting slots under Meetings so you can assign attendees.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {booths.map((b) => (
            <li key={b.id}>
              <Link to={`/events/${eventId}/vendor-booths/${b.id}`} className={styles.row}>
                <span className={styles.vendorName}>{b.vendor_name}</span>
                {b.booth_location ? <span className={styles.meta}>{b.booth_location}</span> : null}
                <span className={styles.chevron} aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
