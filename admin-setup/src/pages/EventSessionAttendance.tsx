import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { buildAgendaDayRows, getSessionDateKeyFromIso } from '../lib/agendaDayRows';
import { formatSessionSlotRange } from '../lib/sessionCheckInRpc';
import type { Event, ScheduleSession } from '../lib/types';
import styles from './EventSessionAttendance.module.css';

type SessionRow = ScheduleSession & { check_in_count: number };

function normalizeSessionTypesList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return ['breakout'];
  return raw
    .split(/[,;|]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function formatTypeLabel(t: string): string {
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function EventSessionAttendance() {
  const { eventId } = useParams<{ eventId: string }>();
  const [eventName, setEventName] = useState('');
  const [eventStart, setEventStart] = useState<string | null>(null);
  const [eventEnd, setEventEnd] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dayFilter, setDayFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [checkInFilter, setCheckInFilter] = useState<'all' | 'has' | 'none'>('all');

  const load = useCallback(async () => {
    if (!eventId) return;
    setError('');
    setLoading(true);
    try {
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .select('id, name, start_date, end_date')
        .eq('id', eventId)
        .single();
      if (evErr) throw evErr;
      const event = ev as Event;
      setEventName(event.name ?? '');
      setEventStart(event.start_date ?? null);
      setEventEnd(event.end_date ?? null);

      const { data: sess, error: sErr } = await supabase
        .from('schedule_sessions')
        .select('id, title, start_time, end_time, location, room, day_number, session_type, check_in_enabled')
        .eq('event_id', eventId)
        .eq('is_active', true)
        .order('start_time', { ascending: true });
      if (sErr) throw sErr;

      const ids = (sess ?? []).map((s) => s.id);
      const counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: cis, error: cErr } = await supabase
          .from('session_check_ins')
          .select('session_id')
          .in('session_id', ids);
        if (cErr && !/session_check_ins|schema cache/i.test(cErr.message)) throw cErr;
        for (const row of cis ?? []) {
          const sid = row.session_id as string;
          counts[sid] = (counts[sid] ?? 0) + 1;
        }
      }

      setSessions(
        (sess ?? []).map((s) => ({
          ...(s as ScheduleSession),
          check_in_count: counts[s.id] ?? 0,
        }))
      );
    } catch (e) {
      setError(postgrestErrorMessage(e));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const dayOptions = useMemo(() => {
    return buildAgendaDayRows(sessions, eventStart, eventEnd).map((row) => ({
      dateKey: row.dateKey,
      label: row.dateLabel,
      count: row.items.length,
    }));
  }, [sessions, eventStart, eventEnd]);

  const sessionTypes = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      for (const t of normalizeSessionTypesList(s.session_type)) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (dayFilter !== 'all') {
        const key = getSessionDateKeyFromIso(s.start_time);
        if (key !== dayFilter) return false;
      }
      if (typeFilter !== 'all') {
        const types = normalizeSessionTypesList(s.session_type);
        if (!types.includes(typeFilter)) return false;
      }
      if (checkInFilter === 'has' && s.check_in_count < 1) return false;
      if (checkInFilter === 'none' && s.check_in_count > 0) return false;
      if (q) {
        const hay = [
          s.title,
          s.room,
          s.location,
          formatSessionSlotRange(s.start_time, s.end_time),
          ...normalizeSessionTypesList(s.session_type),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, searchQuery, dayFilter, typeFilter, checkInFilter]);

  const groupedDays = useMemo(() => {
    const rows = buildAgendaDayRows(filteredSessions, eventStart, eventEnd);
    return rows
      .map((row) => ({
        ...row,
        items: row.items.filter((s) => filteredSessions.some((f) => f.id === s.id)),
      }))
      .filter((row) => row.items.length > 0);
  }, [filteredSessions, eventStart, eventEnd]);

  const hasActiveFilters =
    searchQuery.trim() !== '' || dayFilter !== 'all' || typeFilter !== 'all' || checkInFilter !== 'all';

  const clearFilters = () => {
    setSearchQuery('');
    setDayFilter('all');
    setTypeFilter('all');
    setCheckInFilter('all');
  };

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
      </div>
      <h1>Session attendance — {eventName || 'Event'}</h1>
      <p className={styles.hint}>
        Event admins check people in at the room using <strong>Session check-in (scan)</strong> in the mobile app.
        Open a session for the full list: everyone who bookmarked the session (checked in or did not check in) plus
        walk-ins who checked in without a bookmark.
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}

      {sessions.length > 0 ? (
        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by session title, room, or location…"
            aria-label="Search sessions"
          />
          <div className={styles.filterRow}>
            <select
              className={styles.select}
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              aria-label="Filter by day"
            >
              <option value="all">All days</option>
              {dayOptions.map((d) => (
                <option key={d.dateKey} value={d.dateKey}>
                  {d.label} ({d.count})
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by session type"
            >
              <option value="all">All types</option>
              {sessionTypes.map((t) => (
                <option key={t} value={t}>
                  {formatTypeLabel(t)}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={checkInFilter}
              onChange={(e) => setCheckInFilter(e.target.value as 'all' | 'has' | 'none')}
              aria-label="Filter by check-in status"
            >
              <option value="all">Any check-ins</option>
              <option value="has">Has check-ins</option>
              <option value="none">No check-ins yet</option>
            </select>
            {hasActiveFilters ? (
              <button type="button" className={styles.clearBtn} onClick={clearFilters}>
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className={styles.resultSummary}>
        Showing {filteredSessions.length} of {sessions.length} session{sessions.length === 1 ? '' : 's'}
        {hasActiveFilters ? ' (filtered)' : ''}
      </p>

      <section>
        {sessions.length === 0 ? (
          <p className={styles.muted}>No active sessions. Add sessions under Schedule first.</p>
        ) : filteredSessions.length === 0 ? (
          <p className={styles.muted}>No sessions match your filters. Try clearing filters or changing your search.</p>
        ) : (
          groupedDays.map((day) => (
            <div key={day.dateKey} className={styles.dayBlock}>
              <h2 className={styles.dayHeading}>
                {day.dateLabel}
                <span className={styles.dayCount}>
                  {' '}
                  · {day.items.length} session{day.items.length === 1 ? '' : 's'}
                </span>
              </h2>
              <ul className={styles.linkList}>
                {day.items.map((s) => {
                  const types = normalizeSessionTypesList(s.session_type);
                  return (
                    <li key={s.id}>
                      <Link
                        to={`/events/${eventId}/session-attendance/${s.id}`}
                        className={styles.sessionLink}
                      >
                        <strong>{s.title}</strong>
                        <span className={styles.sessionMeta}>
                          {formatSessionSlotRange(s.start_time, s.end_time)}
                          {s.room || s.location
                            ? ` · ${[s.room, s.location].filter(Boolean).join(', ')}`
                            : ''}
                        </span>
                        {types.length > 0 ? (
                          <span className={styles.sessionType}>{types.map(formatTypeLabel).join(' · ')}</span>
                        ) : null}
                        {s.check_in_enabled === false ? (
                          <span className={styles.sessionType}>Hidden from mobile Session check-in</span>
                        ) : null}
                        <span className={styles.sessionCount}>
                          {(s as SessionRow).check_in_count ?? 0} checked in
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
