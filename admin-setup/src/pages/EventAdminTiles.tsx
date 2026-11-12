import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { canManageEventAdminConsoleTiles } from '../lib/canManageEventAdminConsoleTiles';
import {
  EVENT_EXPERIENCE_CONTROLS,
  EXPERIENCE_CONTROL_GROUPS,
  HAMBURGER_TAB_SHORTCUTS,
  type ExperienceControlDef,
  buildHamburgerShortcutSavePayload,
  buildPlatformSavePayload,
  hamburgerShortcutDraftFromEvent,
  platformExperienceDraftFromEvent,
} from '../lib/eventExperienceControls';
import type { Event } from '../lib/types';
import styles from './EventAdminTiles.module.css';

const EVENT_SELECT =
  'id, name, event_code, start_date, end_date, admin_console_tiles, menu_show_1on1, menu_show_live_wall, menu_show_solution_providers, menu_show_scan_badge, menu_show_notes, menu_show_scan_notes, menu_show_agenda, menu_show_session_check_in, platform_menu_show_agenda, platform_menu_show_1on1, platform_menu_show_scan_badge, platform_menu_show_solution_providers, platform_menu_show_live_wall, platform_menu_show_notes, platform_menu_show_scan_notes, platform_menu_show_session_check_in, platform_hamburger_show_info, platform_hamburger_show_feed, platform_hamburger_show_agenda, platform_hamburger_show_community, platform_hamburger_show_rank';

const EVENT_SELECT_BASE = 'id, name, event_code, start_date, end_date';

type CheckItem = { id: string; title: string; desc: string; tags: string[] };

function sameDraft(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] === true) !== (b[k] === true)) return false;
  return true;
}

function controlToItem(c: ExperienceControlDef): CheckItem {
  return { id: c.id, title: c.title, desc: c.desc, tags: c.tags };
}

export default function EventAdminTiles() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [hamburgerDraft, setHamburgerDraft] = useState<Record<string, boolean>>({});
  const [savedDraft, setSavedDraft] = useState<Record<string, boolean>>({});
  const [savedHamburgerDraft, setSavedHamburgerDraft] = useState<Record<string, boolean>>({});
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
          const initialDraft = platformExperienceDraftFromEvent(row);
          const initialHamburger = hamburgerShortcutDraftFromEvent(row);
          setDraft(initialDraft);
          setSavedDraft(initialDraft);
          setHamburgerDraft(initialHamburger);
          setSavedHamburgerDraft(initialHamburger);
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
    setDraft((prev) => {
      const next = { ...prev, [id]: on };
      // An event uses Standard registration or Matchmaking, never both.
      if (on && id === 'standard_registration') next.matchmaking = false;
      if (on && id === 'matchmaking') next.standard_registration = false;
      return next;
    });
    setSaveOk(false);
  };

  const toggleHamburgerDraft = (id: string, on: boolean) => {
    setHamburgerDraft((prev) => ({ ...prev, [id]: on }));
    setSaveOk(false);
  };

  const groups = useMemo(() => {
    const byId = new Map(EVENT_EXPERIENCE_CONTROLS.map((c) => [c.id, c]));
    const used = new Set<string>();
    const out = EXPERIENCE_CONTROL_GROUPS.map((g) => {
      const items = g.controlIds
        .map((id) => byId.get(id))
        .filter((c): c is ExperienceControlDef => Boolean(c))
        .map((c) => {
          used.add(c.id);
          return controlToItem(c);
        });
      return { id: g.id, title: g.title, desc: g.desc, items };
    });
    const leftovers = EVENT_EXPERIENCE_CONTROLS.filter((c) => !used.has(c.id)).map(controlToItem);
    if (leftovers.length > 0) {
      out.push({ id: 'other', title: 'Other', desc: 'Additional features', items: leftovers });
    }
    return out.filter((g) => g.items.length > 0);
  }, []);

  const hamburgerItems = useMemo<CheckItem[]>(
    () => HAMBURGER_TAB_SHORTCUTS.map((h) => ({ id: h.id, title: h.title, desc: h.desc, tags: ['Hamburger'] })),
    [],
  );

  const dirty = !sameDraft(draft, savedDraft) || !sameDraft(hamburgerDraft, savedHamburgerDraft);

  const setGroup = (ids: string[], on: boolean) => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = on;
      return next;
    });
    setSaveOk(false);
  };

  const setHamburgerGroup = (on: boolean) => {
    setHamburgerDraft((prev) => {
      const next = { ...prev };
      for (const item of HAMBURGER_TAB_SHORTCUTS) next[item.id] = on;
      return next;
    });
    setSaveOk(false);
  };

  const renderCard = (
    key: string,
    title: string,
    desc: string,
    items: CheckItem[],
    values: Record<string, boolean>,
    onToggle: (id: string, on: boolean) => void,
    onSetAll: (on: boolean) => void,
  ) => {
    const onCount = items.filter((i) => values[i.id] === true).length;
    const allOn = onCount === items.length;
    return (
      <section key={key} className={styles.groupCard}>
        <div className={styles.groupHead}>
          <div>
            <h2 className={styles.groupTitle}>{title}</h2>
            <p className={styles.groupDesc}>{desc}</p>
          </div>
          <div className={styles.groupHeadRight}>
            <span className={styles.groupCount}>
              {onCount} of {items.length} on
            </span>
            <button type="button" className={styles.groupToggleAll} onClick={() => onSetAll(!allOn)}>
              {allOn ? 'Turn all off' : 'Turn all on'}
            </button>
          </div>
        </div>
        <ul className={styles.groupGrid}>
          {items.map((item) => (
            <li key={item.id}>
              <label className={`${styles.tileCheckLabel} ${values[item.id] ? styles.tileCheckLabelOn : ''}`}>
                <input
                  type="checkbox"
                  checked={values[item.id] === true}
                  onChange={(e) => onToggle(item.id, e.target.checked)}
                />
                <span>
                  <span className={styles.tileCheckTitleRow}>
                    <strong>{item.title}</strong>
                    <span className={styles.tagRow}>
                      {item.tags.map((tag) => (
                        <span key={tag} className={tag === 'Web admin' ? styles.tagWeb : styles.tagApp}>
                          {tag}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className={styles.tileCheckDesc}>{item.desc}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>
    );
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
      const hamburger = buildHamburgerShortcutSavePayload(hamburgerDraft);
      const { error: upErr } = await supabase
        .from('events')
        .update({
          admin_console_tiles,
          ...platform,
          ...menu,
          ...hamburger,
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
              ...hamburger,
            }
          : prev
      );
      setSavedDraft(draft);
      setSavedHamburgerDraft(hamburgerDraft);
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

      <div className={styles.groupStack}>
        {groups.map((g) =>
          renderCard(
            g.id,
            g.title,
            g.desc,
            g.items,
            draft,
            toggleDraft,
            (on) => setGroup(g.items.map((i) => i.id), on),
          ),
        )}
        {renderCard(
          'hamburger',
          'Side menu shortcuts',
          'Info, Feed, Agenda, Community, and Rank stay on the bottom bar. Turn any on to also list them in the side menu. Agenda still follows the event admin Agenda setting.',
          hamburgerItems,
          hamburgerDraft,
          toggleHamburgerDraft,
          setHamburgerGroup,
        )}
      </div>

      <div className={styles.saveBar}>
        <div className={styles.saveBarStatus}>
          {saveError ? (
            <span className={styles.saveError}>{saveError}</span>
          ) : dirty ? (
            <span className={styles.saveDirty}>Unsaved changes</span>
          ) : saveOk ? (
            <span className={styles.saveOk}>Saved.</span>
          ) : (
            <span className={styles.saveIdle}>No changes</span>
          )}
        </div>
        <div className={styles.actions}>
          <Link to={`/events/${eventId}`} className={styles.cancelLink}>
            Done
          </Link>
          <button type="button" className={styles.saveBtn} disabled={saving || !dirty} onClick={saveSettings}>
            {saving ? 'Saving…' : 'Save visibility'}
          </button>
        </div>
      </div>
    </div>
  );
}
