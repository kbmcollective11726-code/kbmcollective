import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { uploadEventImage } from '../lib/uploadEventImage';
import type { Event, EventSponsor } from '../lib/types';
import styles from './EventSponsors.module.css';

type Props = { sponsor: EventSponsor; eventId: string; onChanged: () => void };

function SponsorEditor({ sponsor, eventId, onChanged }: Props) {
  const [companyName, setCompanyName] = useState(sponsor.company_name);
  const [tierLabel, setTierLabel] = useState(sponsor.tier_label ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(sponsor.website_url ?? '');
  const [logoUrl, setLogoUrl] = useState(sponsor.logo_url ?? '');
  const [sortOrder, setSortOrder] = useState(String(sponsor.sort_order));
  const [showInfo, setShowInfo] = useState(sponsor.show_on_info_screen);
  const [showHamburgerHeader, setShowHamburgerHeader] = useState(
    sponsor.show_in_hamburger_header ?? sponsor.show_in_hamburger ?? true
  );
  const [showHamburgerFooter, setShowHamburgerFooter] = useState(
    sponsor.show_in_hamburger_footer ?? sponsor.show_in_hamburger ?? true
  );
  const [showSchedule, setShowSchedule] = useState(sponsor.show_on_schedule);
  const [showFeed, setShowFeed] = useState(sponsor.show_on_feed);
  const [showLiveWall, setShowLiveWall] = useState(!!sponsor.show_on_live_wall);
  const [active, setActive] = useState(sponsor.is_active);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCompanyName(sponsor.company_name);
    setTierLabel(sponsor.tier_label ?? '');
    setWebsiteUrl(sponsor.website_url ?? '');
    setLogoUrl(sponsor.logo_url ?? '');
    setSortOrder(String(sponsor.sort_order));
    setShowInfo(sponsor.show_on_info_screen);
    setShowHamburgerHeader(sponsor.show_in_hamburger_header ?? sponsor.show_in_hamburger ?? true);
    setShowHamburgerFooter(sponsor.show_in_hamburger_footer ?? sponsor.show_in_hamburger ?? true);
    setShowSchedule(sponsor.show_on_schedule);
    setShowFeed(sponsor.show_on_feed);
    setShowLiveWall(!!sponsor.show_on_live_wall);
    setActive(sponsor.is_active);
  }, [sponsor]);

  const save = async (file: File | null) => {
    setErr('');
    const name = companyName.trim();
    if (!name) {
      setErr('Company name is required.');
      return;
    }
    const so = parseInt(sortOrder, 10);
    setSaving(true);
    try {
      let nextLogo = logoUrl.trim() || null;
      if (file) {
        nextLogo = await uploadEventImage(file, eventId, 'sponsor-logos');
        setLogoUrl(nextLogo);
      }
      const { error } = await supabase
        .from('event_sponsors')
        .update({
          company_name: name,
          tier_label: tierLabel.trim() || null,
          website_url: websiteUrl.trim() || null,
          logo_url: nextLogo,
          sort_order: Number.isFinite(so) ? so : 0,
          show_on_info_screen: showInfo,
          show_in_hamburger: showHamburgerHeader || showHamburgerFooter,
          show_in_hamburger_header: showHamburgerHeader,
          show_in_hamburger_footer: showHamburgerFooter,
          show_on_schedule: showSchedule,
          show_on_feed: showFeed,
          show_on_live_wall: showLiveWall,
          is_active: active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sponsor.id);
      if (error) throw error;
      onChanged();
    } catch (e) {
      setErr(postgrestErrorMessage(e) || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove sponsor “${sponsor.company_name}”?`)) return;
    setDeleting(true);
    setErr('');
    try {
      const { error } = await supabase.from('event_sponsors').delete().eq('id', sponsor.id);
      if (error) throw error;
      onChanged();
    } catch (e) {
      setErr(postgrestErrorMessage(e) || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={styles.card}>
      {err ? <p className={styles.error}>{err}</p> : null}
      <label className={styles.label}>
        Company name *
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      </label>
      <p className={styles.tierHint}>
        Tier / package label (e.g. Presenting sponsor, Gold) — shown above the logo in the app.
      </p>
      <label className={styles.label}>
        Tier label
        <input value={tierLabel} onChange={(e) => setTierLabel(e.target.value)} placeholder="e.g. Gold sponsor" />
      </label>
      <label className={styles.label}>
        Website (optional)
        <input
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          type="url"
          placeholder="https://"
        />
      </label>
      <div className={styles.logoRow}>
        <div className={styles.logoPreview}>
          {logoUrl ? <img src={logoUrl} alt="" /> : <span className={styles.meta}>No logo</span>}
        </div>
        <div>
          <input
            type="file"
            accept="image/*"
            className={styles.hiddenFile}
            id={`logo-${sponsor.id}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void save(f);
            }}
          />
          <label htmlFor={`logo-${sponsor.id}`}>
            <span className={`${styles.btn} ${styles.btnGhost}`} style={{ display: 'inline-block' }}>
              {saving ? 'Uploading…' : 'Change logo'}
            </span>
          </label>
          <p className={styles.meta}>
            Upload saves immediately. Use <strong>3:1</strong> (e.g. 1200×400 px) — see the blue note at the top of this
            page.
          </p>
        </div>
      </div>
      <label className={styles.label}>
        Sort order
        <input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
      </label>
      <p className={styles.meta}>Lower numbers appear first when multiple sponsors share the same area.</p>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} />
        <span>Info tab — &quot;Sponsored by&quot; block (on/off per sponsor)</span>
      </label>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={showHamburgerHeader}
          onChange={(e) => setShowHamburgerHeader(e.target.checked)}
        />
        <span>Hamburger — small logo beside &quot;Menu&quot; (top of drawer)</span>
      </label>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={showHamburgerFooter}
          onChange={(e) => setShowHamburgerFooter(e.target.checked)}
        />
        <span>Hamburger — &quot;Sponsored by&quot; block (bottom of drawer)</span>
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={showSchedule} onChange={(e) => setShowSchedule(e.target.checked)} />
        <span>Compact strip on Schedule tab</span>
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={showFeed} onChange={(e) => setShowFeed(e.target.checked)} />
        <span>Compact strip on Feed (top of list)</span>
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={showLiveWall} onChange={(e) => setShowLiveWall(e.target.checked)} />
        <span>
          Live wall — logo on the purple bar (no frame). Use a <strong>transparent PNG</strong> so it doesn’t show a white
          box; JPGs with letterboxing will look as-uploaded.
        </span>
      </label>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Active (hidden everywhere if off)</span>
      </label>
      <div className={styles.rowActions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving} onClick={() => void save(null)}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={deleting} onClick={() => void remove()}>
          {deleting ? 'Removing…' : 'Delete sponsor'}
        </button>
      </div>
    </div>
  );
}

function NewSponsorForm({ eventId, onCreated }: { eventId: string; onCreated: () => void }) {
  const [companyName, setCompanyName] = useState('');
  const [tierLabel, setTierLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const add = async () => {
    const name = companyName.trim();
    if (!name) {
      setErr('Enter a company name.');
      return;
    }
    setErr('');
    setSaving(true);
    try {
      const { error } = await supabase.from('event_sponsors').insert({
        event_id: eventId,
        company_name: name,
        tier_label: tierLabel.trim() || null,
        show_on_info_screen: true,
        show_in_hamburger: true,
        show_in_hamburger_header: true,
        show_in_hamburger_footer: true,
        show_on_schedule: false,
        show_on_feed: false,
        show_on_live_wall: false,
        is_active: true,
        sort_order: 0,
      });
      if (error) throw error;
      setCompanyName('');
      setTierLabel('');
      onCreated();
    } catch (e) {
      setErr(postgrestErrorMessage(e) || 'Could not add');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.formCard}>
      <h2>Add a sponsor</h2>
      <p className={styles.hint} style={{ marginTop: 0 }}>
        Create the row first, then edit it to upload a logo, set website, and choose Info vs menu placement. Logos work best
        as <strong>3:1</strong> wide banners (e.g. <code style={{ fontSize: 12 }}>1200×400</code> px) so they fill the
        in-app area — see the blue callout on this page.
      </p>
      {err ? <p className={styles.error}>{err}</p> : null}
      <label className={styles.label}>
        Company name *
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Corp" />
      </label>
      <label className={styles.label}>
        Tier label (optional)
        <input value={tierLabel} onChange={(e) => setTierLabel(e.target.value)} placeholder="e.g. Gold" />
      </label>
      <div className={styles.rowActions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving} onClick={() => void add()}>
          {saving ? 'Adding…' : 'Add sponsor'}
        </button>
      </div>
    </div>
  );
}

export default function EventSponsors() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [sponsors, setSponsors] = useState<EventSponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!eventId) return;
    setError('');
    try {
      const { data: ev, error: evErr } = await supabase.from('events').select('id, name').eq('id', eventId).single();
      if (evErr) throw evErr;
      setEvent((ev as Event) ?? null);
      const { data, error: spErr } = await supabase
        .from('event_sponsors')
        .select('*')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (spErr) throw spErr;
      setSponsors((data as EventSponsor[]) ?? []);
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Failed to load');
      setSponsors([]);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  if (!eventId) return <div className={styles.error}>Missing event</div>;
  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <Link to={`/events/${eventId}`} className={styles.back}>
          ← Event
        </Link>
        <h1>Sponsors — {event?.name ?? 'Event'}</h1>
        <p className={styles.hint}>
          Add sponsor rows and assign a <strong>tier</strong> label (e.g. Presenting, Gold). Use the checkboxes so each
          sponsor can appear on the in-app <strong>Info</strong> tab, the hamburger <strong>header</strong> and/or{' '}
          <strong>footer</strong> (separate toggles), and the optional           <strong>Schedule</strong>, <strong>Feed</strong>, and the browser <strong>live wall</strong>{' '}
          (logo bar). Turn a placement off to hide that sponsor there only.
        </p>
        <div className={styles.logoSizeCallout}>
          <strong>Logo dimensions (so it fills the app “Sponsored by” area)</strong>
          Upload a <strong>wide horizontal</strong> image with aspect ratio <strong>3:1</strong> (width = 3× height) — the
          same shape as a full-width banner. Recommended: <code>1200×400</code> px (good minimum) or <code>1800×600</code>{' '}
          px (crisper on large phones). JPG/PNG. The app <strong>fills the frame</strong> edge-to-edge; if your file is
          square or a different ratio, the edges may be <strong>cropped</strong> to fit 3:1.
        </div>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}

      <NewSponsorForm eventId={eventId} onCreated={load} />

      {sponsors.length === 0 ? (
        <p className={styles.hint}>No sponsors yet. Add one above, then open it to upload a logo.</p>
      ) : (
        sponsors.map((s) => <SponsorEditor key={s.id} sponsor={s} eventId={eventId} onChanged={load} />)
      )}
    </div>
  );
}
