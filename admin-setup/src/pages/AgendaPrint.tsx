import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import {
  buildAgendaDayRows,
  formatSessionSpeakersLine,
  formatTime12FromISO,
} from '../lib/agendaDayRows';
import type { Event, ScheduleSession } from '../lib/types';
import styles from './AgendaPrint.module.css';

function formatTypesLabel(raw: string | null | undefined): string {
  const s = String(raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (s.length === 0) return '';
  return s.map((t) => t.replace(/_/g, ' ')).join(' · ');
}

function formatEventDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const a = (start ?? '').trim().slice(0, 10);
  const b = (end ?? '').trim().slice(0, 10);
  if (!a) return '';
  if (!b || a === b) return a;
  return `${a} – ${b}`;
}

function descriptionToParagraphs(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[•\-–—*]\s*/, '').trim())
    .filter(Boolean);
}

/** Matches index.html default — restored when navigating away from agenda print */
const DEFAULT_DOCUMENT_TITLE = 'KBM Connect Admin — Event Setup';

export default function AgendaPrint() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [sessions, setSessions] = useState<ScheduleSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [includeDescriptions, setIncludeDescriptions] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    setError('');
    try {
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select(
          'id, name, start_date, end_date, location, venue, theme_color, logo_url, description, event_code'
        )
        .eq('id', eventId)
        .single();
      if (evErr) throw evErr;
      setEvent((ev as Event) ?? null);

      const { data: rows, error: sErr } = await supabase
        .from('schedule_sessions')
        .select('*')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .order('day_number', { ascending: true })
        .order('start_time', { ascending: true });
      if (sErr) throw sErr;
      setSessions((rows as ScheduleSession[]) ?? []);
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Failed to load agenda');
      setEvent(null);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (event?.name?.trim()) {
      document.title = `${event.name.trim()} · Program agenda`;
    } else if (eventId) {
      document.title = 'Program agenda';
    }
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [eventId, event?.name]);

  const sessionsByDay = useMemo(
    () => buildAgendaDayRows(sessions, event?.start_date, event?.end_date),
    [sessions, event?.start_date, event?.end_date]
  );

  const accent = (event?.theme_color && /^#[0-9A-Fa-f]{6}$/.test(event.theme_color.trim()))
    ? event.theme_color.trim()
    : '#2563eb';

  const footerStamp = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  if (!eventId) return <div className={styles.errorBox}>Missing event</div>;
  if (loading) return <div className={styles.loading}>Loading agenda…</div>;
  if (error) return <div className={styles.errorBox}>{error}</div>;

  return (
    <div className={styles.screenWrap}>
      <div className={`${styles.toolbar} ${styles.noPrint}`}>
        <Link to={`/events/${eventId}/schedule`} className={styles.back}>
          ← Schedule
        </Link>
        <div className={styles.toolbarActions}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={includeDescriptions}
              onChange={(e) => setIncludeDescriptions(e.target.checked)}
            />
            Include descriptions
          </label>
          <button type="button" className={styles.printBtn} onClick={() => window.print()}>
            Print agenda
          </button>
        </div>
      </div>
      <p className={`${styles.hint} ${styles.noPrint}`}>
        For PDF: turn on <strong>Background graphics</strong> so the navy header prints. To remove the{' '}
        <strong>title line, URL, and top date</strong> that the browser adds, turn off{' '}
        <strong>Headers and footers</strong> in the print dialog (Chrome: Print → More settings).
      </p>

      <article className={styles.sheet} style={{ ['--agenda-accent' as string]: accent }}>
        <header className={styles.sheetHeader}>
          <div className={styles.headerInner}>
            <div className={styles.headerText}>
              <h1 className={styles.eventName}>{event?.name ?? 'Event agenda'}</h1>
              {event?.description?.trim() && event.description.trim().length <= 280 ? (
                <p className={styles.tagline}>{event.description.trim()}</p>
              ) : (
                <p className={styles.tagline}>Program agenda</p>
              )}
              <div className={styles.metaRow}>
                <span className={styles.metaItem}>
                  <strong>Dates</strong> {formatEventDateRange(event?.start_date, event?.end_date) || '—'}
                </span>
                {event?.venue?.trim() ? (
                  <span className={styles.metaItem}>
                    <strong>Venue</strong> {event.venue.trim()}
                  </span>
                ) : null}
                {event?.location?.trim() ? (
                  <span className={styles.metaItem}>
                    <strong>Location</strong> {event.location.trim()}
                  </span>
                ) : null}
              </div>
            </div>
            {event?.logo_url?.trim() ? (
              <img src={event.logo_url.trim()} alt="" className={styles.logo} />
            ) : null}
          </div>
        </header>

        <div className={styles.sheetBody}>
          {sessions.length === 0 ? (
            <p className={styles.emptyDay}>No active sessions for this event yet.</p>
          ) : (
            sessionsByDay.map(({ dayNum, dateLabel, dateKey, items }) => (
              <section key={dateKey} className={styles.dayBlock}>
                <div className={styles.dayHead}>
                  <h2 className={styles.dayLabel}>
                    {dayNum != null ? `Day ${dayNum}` : 'Sessions'}
                  </h2>
                  <span className={styles.dayDate}>{dateLabel}</span>
                </div>
                {items.length === 0 ? (
                  <p className={styles.emptyDay}>No sessions this day.</p>
                ) : (
                  items.map((s) => {
                    const types = formatTypesLabel(s.session_type);
                    const placeParts = [s.location?.trim(), s.room?.trim()].filter(Boolean);
                    const descParas = includeDescriptions ? descriptionToParagraphs(s.description) : [];
                    return (
                      <div key={s.id} className={styles.sessionCard}>
                        <div className={styles.timeCol}>
                          {formatTime12FromISO(s.start_time)}
                          <span className={styles.timeDash}>
                            {formatTime12FromISO(s.end_time)}
                          </span>
                        </div>
                        <div className={styles.detailCol}>
                          {types ? <span className={styles.typePill}>{types}</span> : null}
                          <h3 className={styles.sessionTitle}>{s.title}</h3>
                          {formatSessionSpeakersLine(s) ? (
                            <p className={styles.speakers}>
                              <strong>Speakers</strong> {formatSessionSpeakersLine(s)}
                            </p>
                          ) : null}
                          {placeParts.length > 0 ? (
                            <p className={styles.place}>
                              <strong>Where</strong> {placeParts.join(' · ')}
                            </p>
                          ) : null}
                          {descParas.length > 0 ? (
                            <div className={styles.description}>
                              {descParas.map((line, i) => (
                                <p key={i}>{line}</p>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </section>
            ))
          )}
          <footer className={styles.footerNote}>
            <p className={styles.footerDateLine}>Prepared {footerStamp}</p>
            {event?.event_code ? (
              <p className={styles.footerMetaLine}>Event code: {event.event_code}</p>
            ) : null}
          </footer>
        </div>
      </article>
    </div>
  );
}
