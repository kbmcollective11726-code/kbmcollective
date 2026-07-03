import { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { canManageEventAdminConsoleTiles } from '../lib/canManageEventAdminConsoleTiles';
import {
  EVENT_EXPERIENCE_CONTROLS,
  buildPlatformSavePayload,
  platformExperienceDraftFromEvent,
} from '../lib/eventExperienceControls';
import type { Event } from '../lib/types';
import styles from './EventAdminTiles.module.css';

const EVENT_SELECT =
  'id, name, event_code, start_date, end_date, admin_console_tiles, menu_show_1on1, menu_show_live_wall, menu_show_solution_providers, menu_show_scan_badge, menu_show_notes, menu_show_agenda, menu_show_session_check_in, platform_menu_show_agenda, platform_menu_show_1on1, platform_menu_show_scan_badge, platform_menu_show_solution_providers, platform_menu_show_live_wall, platform_menu_show_notes, platform_menu_show_session_check_in';

const EVENT_SELECT_BASE = 'id, name, event_code, start_date, end_date';

export default function EventAdminTiles() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk, setSaveOk] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const canManage = await canManageEventAdminConsoleTiles();
        if (cancelled) return;
        setAllowed(canManage);
        if (!canManage) {
          setLoading(false);
          return;
        }

        const { data, error: err } = await supabase.from('events').select(EVENT_SELECT).eq('id', eventId).single();
        let row: Event;
        if (err && /admin_console_tiles|menu_show|platform_menu|schema cache/i.test(err.message)) {
          const fallback = await supabase.from('events').select(EVENT_SELECT_BASE).eq('id', eventId).single();
          if (fallback.error) throw fallback.error;
          row = fallback.data as Event;
        } else if (err) {
          throw err;
        } else {
          row = data as Event;
        }
        if (!cancelled) {
          setEvent(row);
          setDraft(platformExperienceDraftFromEvent(row));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load event');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const toggleDraft = (id: string, on: boolean) => {
    setDraft((prev) => ({ ...prev, [id]: on }));
    setSaveOk(false);
  };

  const saveSettings = async () => {
    if (!eventId || saving) return;
    const anyOn = EVENT_EXPERIENCE_CONTROLS.some((c) => draft[c.id]);
    if (!anyOn) {
      setSaveError('Choose at least one item for event admins.');
      return;
    }
    setSaveError('');
    setSaveOk(false);
    setSaving(true);
    try {
      const { admin_console_tiles, platform, menu } = buildPlatformSavePayload(draft);
      const { error: upErr } = await supabase
        .from('events')
        .update({
          admin_console_tiles,
          ...platform,
          ...menu,
        })
        .eq('id', eventId);
      if (upErr) throw upErr;
      setEvent((prev) =>
        prev
          ? {
              ...prev,
              admin_console_tiles,
              ...platform,
              ...menu,
            }
          : prev
      );
      setSaveOk(true);
    } catch (e) {
      setSaveError(postgrestErrorMessage(e) || (e instanceof Error ? e.message : 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  if (!eventId) return <Navigate to="/" replace />;
  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (!allowed) return <Navigate to={`/events/${eventId}`} replace />;
  if (error || !event) return <div className={styles.error}>{error || 'Event not found'}</div>;

  return (
    <div className={styles.page}>
      <p className={styles.back}>
        <Link to={`/events/${eventId}`}>← Back to event</Link>
      </p>
      <div className={styles.head}>
        <div>
          <h1>Event admin tiles</h1>
          <p className={styles.subtitle}>
            {event.name}
            {event.event_code ? ` · ${event.event_code}` : ''} · {event.start_date} – {event.end_date}
          </p>
        </div>
      </div>

      <p className={styles.intro}>
        Choose what <strong>event admins</strong> may use on the <strong>web hub</strong> and which{' '}
        <strong>app menu</strong> items they can turn on or off from the event home page. You always see everything.
        Checking an <span className={styles.tagApp}>App menu</span> item allows it and turns it on initially; event admins
        can hide it later without losing access to the web tools.
      </p>

      <div className={styles.panel}>
        <ul className={styles.tileCheckList}>
          {EVENT_EXPERIENCE_CONTROLS.map((control) => (
            <li key={control.id}>
              <label className={styles.tileCheckLabel}>
                <input
                  type="checkbox"
                  checked={draft[control.id] === true}
                  onChange={(e) => toggleDraft(control.id, e.target.checked)}
                />
                <span>
                  <span className={styles.tileCheckTitleRow}>
                    <strong>{control.title}</strong>
                    <span className={styles.tagRow}>
                      {control.tags.map((tag) => (
                        <span
                          key={tag}
                          className={tag === 'Web admin' ? styles.tagWeb : styles.tagApp}
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className={styles.tileCheckDesc}>{control.desc}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {saveError ? <p className={styles.saveError}>{saveError}</p> : null}
        {saveOk ? <p className={styles.saveOk}>Saved.</p> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.saveBtn} disabled={saving} onClick={saveSettings}>
            {saving ? 'Saving…' : 'Save visibility'}
          </button>
          <Link to={`/events/${eventId}`} className={styles.cancelLink}>
            Done
          </Link>
        </div>
      </div>
    </div>
  );
}
