import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import PortalHoldingScreen from '../../components/PortalHoldingScreen';
import {
  formatEventDateRange,
  isStage2Active,
  linkAndLoadVendorSubmission,
  loadVendorPortalEvent,
  loadVendorPortalSettings,
  type VendorPortalEvent,
  type VendorPortalSettings,
} from '../../lib/vendorPortal';
import type { EventRegistrationSubmission } from '../../lib/types';
import styles from '../delegate-portal/DelegatePortal.module.css';

export type VendorPortalContext = {
  event: VendorPortalEvent;
  settings: VendorPortalSettings;
  submission: EventRegistrationSubmission;
  reloadSubmission: () => Promise<void>;
};

export const VENDOR_PORTAL_STEPS = ['welcome', 'registration'] as const;

export function vendorStepPath(eventId: string, step: string) {
  return `/portal/${eventId}/vendor/${step}`;
}

export default function VendorPortalLayout() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [event, setEvent] = useState<VendorPortalEvent | null>(null);
  const [settings, setSettings] = useState<VendorPortalSettings | null>(null);
  const [submission, setSubmission] = useState<EventRegistrationSubmission | null>(null);
  const [userLabel, setUserLabel] = useState('');

  const reloadSubmission = useCallback(async () => {
    if (!eventId) return;
    const sub = await linkAndLoadVendorSubmission(eventId);
    setSubmission(sub);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          navigate(`/portal/${eventId}/vendor/login`, { replace: true });
          return;
        }
        const [eventRow, settingsRow, sub] = await Promise.all([
          loadVendorPortalEvent(eventId),
          loadVendorPortalSettings(eventId),
          linkAndLoadVendorSubmission(eventId),
        ]);
        if (!eventRow) throw new Error('Event not found.');
        if (!sub) {
          navigate(`/portal/${eventId}/vendor/login`, {
            replace: true,
            state: { error: 'No submitted vendor registration found for this account.' },
          });
          return;
        }
        if (sub.registration_status === 'rejected') {
          throw new Error('Your registration was not approved. Contact the event organizer.');
        }
        const profileEmail = sessionData.session.user.email ?? '';
        const name = [sub.first_name, sub.last_name].filter(Boolean).join(' ') || profileEmail;
        if (!cancelled) {
          setEvent(eventRow);
          setSettings(settingsRow);
          setSubmission(sub);
          setUserLabel(name);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load portal');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, navigate]);

  const visibleSteps = useMemo(() => [...VENDOR_PORTAL_STEPS], []);

  const currentStepIndex = useMemo(() => {
    if (location.pathname.endsWith('/registration')) return 1;
    return 0;
  }, [location.pathname]);

  const prevPath = useMemo(() => {
    if (currentStepIndex <= 0 || !eventId) return null;
    return vendorStepPath(eventId, visibleSteps[currentStepIndex - 1] ?? 'welcome');
  }, [currentStepIndex, eventId, visibleSteps]);

  const nextPath = useMemo(() => {
    if (!eventId) return null;
    const next = visibleSteps[currentStepIndex + 1];
    return next ? vendorStepPath(eventId, next) : null;
  }, [currentStepIndex, eventId, visibleSteps]);

  const logout = async () => {
    await supabase.auth.signOut();
    if (eventId) navigate(`/portal/${eventId}/vendor/login`, { replace: true });
  };

  if (loading) return <div className={styles.loading}>Loading your vendor portal…</div>;
  if (error || !event || !settings || !submission) {
    return (
      <div className={styles.loginWrap}>
        <p className={styles.error}>{error || 'Portal unavailable.'}</p>
      </div>
    );
  }

  if (!isStage2Active(settings, 'vendor')) {
    return (
      <PortalHoldingScreen eventName={event.name} message={settings.stage2_holding_message} />
    );
  }

  const dateRange = formatEventDateRange(event.start_date, event.end_date);
  const locationLine = [event.venue, event.location].filter(Boolean).join(' — ');

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        {event.banner_url ? <img src={event.banner_url} alt="" className={styles.heroImage} /> : null}
        {(dateRange || locationLine) ? (
          <div className={styles.heroMeta}>
            {dateRange ? <div>{dateRange}</div> : null}
            {locationLine ? <div>{locationLine}</div> : null}
          </div>
        ) : null}
      </header>

      <nav className={styles.navBar}>
        <NavLink to={vendorStepPath(event.id, 'welcome')} className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)} end>
          Welcome
        </NavLink>
        <NavLink to={vendorStepPath(event.id, 'registration')} className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}>
          Registration Details
        </NavLink>
        <div className={styles.userBar}>
          <span>{userLabel}</span>
          <button type="button" className={styles.logoutBtn} onClick={() => void logout()}>
            Logout
          </button>
        </div>
      </nav>

      {!submission.profile_complete ? (
        <div className={styles.bannerHint} style={{ padding: '12px 20px', background: '#fef3c7', color: '#92400e' }}>
          Complete your profile below to join the 1:1 matching pool.
        </div>
      ) : null}

      <main className={styles.main}>
        <Outlet context={{ event, settings, submission, reloadSubmission } satisfies VendorPortalContext} />
      </main>

      <footer className={styles.footerNav}>
        {prevPath ? (
          <Link to={prevPath} className={styles.footerBtn}>← Previous</Link>
        ) : (
          <span className={styles.footerBtnDisabled}>← Previous</span>
        )}
        {nextPath ? (
          <Link to={nextPath} className={styles.footerBtn}>Next →</Link>
        ) : (
          <span className={styles.footerBtnDisabled}>Next →</span>
        )}
      </footer>
    </div>
  );
}
