import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { postgrestErrorMessage } from '../lib/postgrestErrorMessage';
import { publicEventSiteUrl } from '../lib/publicPortalUrl';
import type { EventRegistrationForm } from '../lib/types';
import styles from './StandardRegistrationSetup.module.css';

interface FaqItem {
  question: string;
  answer: string;
}

interface SiteRow {
  event_id: string;
  slug: string;
  is_enabled: boolean;
  faq: FaqItem[];
  form_id: string | null;
  registration_open: boolean;
  auto_approve: boolean;
}

type SitePatch = Partial<Pick<SiteRow, 'slug' | 'is_enabled' | 'faq' | 'form_id' | 'registration_open' | 'auto_approve'>>;

interface Props {
  eventId: string;
  eventName: string;
  /** Standard registration form for this event (never a Matchmaking form). */
  standardForm: EventRegistrationForm | null;
  onCreateForm: () => Promise<EventRegistrationForm | null>;
}

const SITE_COLUMNS = 'event_id, slug, is_enabled, faq, form_id, registration_open, auto_approve';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function StandardRegistrationSetup({ eventId, eventName, standardForm, onCreateForm }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [site, setSite] = useState<SiteRow | null>(null);
  const [slugDraft, setSlugDraft] = useState('');
  const [faqDraft, setFaqDraft] = useState<FaqItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: siteErr } = await supabase
        .from('event_public_sites')
        .select(SITE_COLUMNS)
        .eq('event_id', eventId)
        .maybeSingle();
      if (siteErr) throw siteErr;
      const row = data as SiteRow | null;
      setSite(row);
      setSlugDraft(row?.slug ?? slugify(eventName));
      setFaqDraft(Array.isArray(row?.faq) ? row!.faq : []);
    } catch (e) {
      setError(postgrestErrorMessage(e) || 'Could not load standard registration settings');
    } finally {
      setLoading(false);
    }
  }, [eventId, eventName]);

  useEffect(() => {
    void load();
  }, [load]);

  const flash = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote(''), 3000);
  };

  const updateSite = async (patch: SitePatch, okText: string) => {
    setBusy(true);
    setError('');
    try {
      const { data, error: upErr } = await supabase
        .from('event_public_sites')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('event_id', eventId)
        .select(SITE_COLUMNS)
        .single();
      if (upErr) {
        if (/duplicate|unique/i.test(upErr.message)) throw new Error('That link is already used by another event.');
        throw upErr;
      }
      setSite(data as SiteRow);
      flash(okText);
    } catch (e) {
      setError(postgrestErrorMessage(e) || (e instanceof Error ? e.message : 'Could not save'));
    } finally {
      setBusy(false);
    }
  };

  const runSetup = async () => {
    setBusy(true);
    setError('');
    try {
      const form = standardForm ?? (await onCreateForm());
      if (!form) throw new Error('Could not create the registration form.');
      if (site) {
        const { data, error: upErr } = await supabase
          .from('event_public_sites')
          .update({ form_id: form.id, updated_at: new Date().toISOString() })
          .eq('event_id', eventId)
          .select(SITE_COLUMNS)
          .single();
        if (upErr) throw upErr;
        setSite(data as SiteRow);
      } else {
        let base = slugify(slugDraft || eventName);
        if (base.length < 3) base = `event-${eventId.slice(0, 8)}`;
        let created: SiteRow | null = null;
        for (let attempt = 0; attempt < 5 && !created; attempt++) {
          const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
          const { data, error: insErr } = await supabase
            .from('event_public_sites')
            .insert({
              event_id: eventId,
              slug: candidate,
              is_enabled: false,
              faq: [],
              form_id: form.id,
              registration_open: false,
              auto_approve: true,
            })
            .select(SITE_COLUMNS)
            .single();
          if (!insErr) created = data as SiteRow;
          else if (!/duplicate|unique/i.test(insErr.message)) throw insErr;
        }
        if (!created) throw new Error('Could not pick a website link. Try a different link name.');
        setSite(created);
        setSlugDraft(created.slug);
      }
      flash('Standard registration is set up. Turn on the website and registration when you are ready.');
    } catch (e) {
      setError(postgrestErrorMessage(e) || (e instanceof Error ? e.message : 'Setup failed'));
    } finally {
      setBusy(false);
    }
  };

  const saveSlug = () => {
    const next = slugify(slugDraft);
    if (!SLUG_RE.test(next) || next.length < 3) {
      setError('Use at least 3 letters or numbers. Dashes are allowed between words.');
      return;
    }
    setSlugDraft(next);
    void updateSite({ slug: next }, 'Website link saved.');
  };

  const saveFaq = () => {
    const cleaned = faqDraft
      .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
      .filter((f) => f.question);
    setFaqDraft(cleaned);
    void updateSite({ faq: cleaned }, 'FAQ saved.');
  };

  const moveFaq = (idx: number, dir: -1 | 1) => {
    setFaqDraft((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });
  };

  if (loading) return <p className={styles.hint}>Loading…</p>;

  const siteUrl = site ? publicEventSiteUrl(site.slug) : '';
  const registerUrl = site ? `${siteUrl}/register` : '';
  const isSetUp = Boolean(site?.form_id) && Boolean(standardForm);
  const faqDirty = JSON.stringify(faqDraft) !== JSON.stringify(site?.faq ?? []);

  return (
    <div className={styles.stack}>
      {error ? <p className={styles.error}>{error}</p> : null}
      {note ? <p className={styles.note}>{note}</p> : null}

      {!isSetUp ? (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Set up standard registration</h2>
          <p className={styles.hint}>
            For events without matchmaking. This creates a public event website and its own simple registration form
            (name, email, company, title, phone, dietary needs, and how they heard about the event). Registrants are
            added to the event in the KBM Connect app. Matchmaking forms, settings, and registrations are not touched.
          </p>
          <button type="button" className={styles.primaryBtn} disabled={busy} onClick={() => void runSetup()}>
            {busy ? 'Setting up…' : 'Set up standard registration'}
          </button>
        </section>
      ) : null}

      {site ? (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Event website</h2>
            <label className={styles.switchRow}>
              <input
                type="checkbox"
                checked={site.is_enabled}
                disabled={busy}
                onChange={(e) =>
                  void updateSite({ is_enabled: e.target.checked }, e.target.checked ? 'Website is on.' : 'Website is off.')
                }
              />
              <span>{site.is_enabled ? 'Website is on' : 'Website is off'}</span>
            </label>
          </div>
          <p className={styles.hint}>
            Anyone with the link can open it. It is not listed or searchable. Home shows the event name, dates, venue,
            banner, logo, and welcome text from the event settings. Agenda shows sessions and speakers from Schedule.
            Sponsors set to appear on the Info screen are shown too. Change them once and the app and website both
            update.
          </p>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>Website link</span>
              <div className={styles.slugInput}>
                <span className={styles.slugPrefix}>/e/</span>
                <input value={slugDraft} onChange={(e) => setSlugDraft(e.target.value)} aria-label="Website link name" />
              </div>
            </label>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={busy || slugify(slugDraft) === site.slug}
              onClick={saveSlug}
            >
              Save link
            </button>
          </div>
          <div className={styles.linkRow}>
            <code className={styles.linkText}>{siteUrl}</code>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => void copyText(siteUrl).then((ok) => flash(ok ? 'Link copied.' : 'Copy failed.'))}
            >
              Copy
            </button>
            <a href={siteUrl} target="_blank" rel="noreferrer" className={styles.secondaryBtn}>
              Open
            </a>
          </div>
          {!site.is_enabled ? <p className={styles.warn}>The website is off. Visitors see "Event page not available."</p> : null}
        </section>
      ) : null}

      {site && isSetUp ? (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Registration</h2>
          <label className={styles.switchRow}>
            <input
              type="checkbox"
              checked={site.registration_open}
              disabled={busy}
              onChange={(e) =>
                void updateSite(
                  { registration_open: e.target.checked },
                  e.target.checked ? 'Registration is open.' : 'Registration is closed.',
                )
              }
            />
            <span>
              <strong>Registration open</strong>
              <span className={styles.switchHint}>
                Shows the Register button on the website and accepts new registrations. Separate from Matchmaking
                registration.
              </span>
            </span>
          </label>
          <label className={styles.switchRow}>
            <input
              type="checkbox"
              checked={site.auto_approve}
              disabled={busy}
              onChange={(e) => void updateSite({ auto_approve: e.target.checked }, 'Saved.')}
            />
            <span>
              <strong>Approve automatically</strong>
              <span className={styles.switchHint}>
                New registrations are added to the event in the app right away. Turn off to approve each one under
                Registrations.
              </span>
            </span>
          </label>
          <div className={styles.linkRow}>
            <code className={styles.linkText}>{registerUrl}</code>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => void copyText(registerUrl).then((ok) => flash(ok ? 'Link copied.' : 'Copy failed.'))}
            >
              Copy registration link
            </button>
          </div>
          {!site.is_enabled && site.registration_open ? (
            <p className={styles.warn}>Turn on the website too. The registration link opens through the website.</p>
          ) : null}
        </section>
      ) : null}

      {site ? (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>FAQ</h2>
            <span className={styles.hint}>Shown on the website's FAQ page. Leave empty to hide the page.</span>
          </div>
          {faqDraft.length === 0 ? <p className={styles.hint}>No questions yet.</p> : null}
          <ol className={styles.faqList}>
            {faqDraft.map((item, idx) => (
              <li key={idx} className={styles.faqItem}>
                <input
                  value={item.question}
                  placeholder="Question, e.g. What should I wear?"
                  onChange={(e) =>
                    setFaqDraft((prev) => prev.map((f, i) => (i === idx ? { ...f, question: e.target.value } : f)))
                  }
                />
                <textarea
                  value={item.answer}
                  placeholder="Answer"
                  rows={3}
                  onChange={(e) =>
                    setFaqDraft((prev) => prev.map((f, i) => (i === idx ? { ...f, answer: e.target.value } : f)))
                  }
                />
                <div className={styles.faqActions}>
                  <button type="button" className={styles.iconBtn} onClick={() => moveFaq(idx, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className={styles.iconBtn} onClick={() => moveFaq(idx, 1)} aria-label="Move down">
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    onClick={() => setFaqDraft((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setFaqDraft((prev) => [...prev, { question: '', answer: '' }])}
            >
              + Add question
            </button>
            <button type="button" className={styles.primaryBtn} disabled={busy || !faqDirty} onClick={saveFaq}>
              Save FAQ
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
