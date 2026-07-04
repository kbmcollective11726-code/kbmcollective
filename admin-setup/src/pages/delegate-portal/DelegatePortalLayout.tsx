import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import PortalHoldingScreen from '../../components/PortalHoldingScreen';
import {
  formatEventDateRange,
  isStage2Active,
  linkAndLoadDelegateSubmission,
  loadDelegatePortalEvent,
  loadDelegatePortalSettings,
  type DelegatePortalEvent,
  type DelegatePortalSettings,
} from '../../lib/delegatePortal';
import type { EventRegistrationSubmission } from '../../lib/types';
import styles from './DelegatePortal.module.css';

export type DelegatePortalContext = {
  event: DelegatePortalEvent;
  settings: DelegatePortalSettings;
  submission: EventRegistrationSubmission;
  reloadSubmission: () => Promise<void>;
};

export const DELEGATE_PORTAL_STEPS = ['welcome', 'hotel', 'registration', 'meetings'] as const;

export function delegateStepPath(eventId: string, step: string) {
  if (step === 'meetings/request') return `/portal/${eventId}/delegate/meetings/request`;
  if (step === 'meetings/sent') return `/portal/${eventId}/delegate/meetings/sent`;
  return `/portal/${eventId}/delegate/${step}`;
}

export default function DelegatePortalLayout() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [event, setEvent] = useState<DelegatePortalEvent | null>(null);
  const [settings, setSettings] = useState<DelegatePortalSettings | null>(null);
  const [submission, setSubmission] = useState<EventRegistrationSubmission | null>(null);
  const [userLabel, setUserLabel] = useState('');
  const [meetingsOpen, setMeetingsOpen] = useState(false);

  const reloadSubmission = useCallback(async () => {
    if (!eventId) return;
    const sub = await linkAndLoadDelegateSubmission(eventId);
    setSubmission(sub);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          navigate(`/portal/${eventId}/delegate/login`, { replace: true });
          return;
        }
        const [eventRow, settingsRow, sub] = await Promise.all([
          loadDelegatePortalEvent(eventId),
          loadDelegatePortalSettings(eventId),
          linkAndLoadDelegateSubmission(eventId),
        ]);
        if (!eventRow) throw new Error('Event not found.');
        if (!sub) {
          navigate(`/portal/${eventId}/delegate/login`, { replace: true, state: { error: 'No submitted registration found for this account.' } });
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

  const visibleSteps = useMemo(() => {
    const steps: string[] = ['welcome'];
    if (settings?.delegate_portal_hotel_visible !== false) steps.push('hotel');
    steps.push('registration');
    return steps;
  }, [settings]);

  const currentStepIndex = useMemo(() => {
    const path = location.pathname;
    if (path.includes('/meetings/')) return visibleSteps.length;
    if (path.endsWith('/hotel')) return visibleSteps.indexOf('hotel');
    if (path.endsWith('/registration')) return visibleSteps.indexOf('registration');
    return 0;
  }, [location.pathname, visibleSteps]);

  const prevPath = useMemo(() => {
    if (currentStepIndex <= 0 || !eventId) return null;
    return delegateStepPath(eventId, visibleSteps[currentStepIndex - 1] ?? 'welcome');
  }, [currentStepIndex, eventId, visibleSteps]);

  const nextPath = useMemo(() => {
    if (!eventId) return null;
    if (location.pathname.includes('/meetings/')) return null;
    const next = visibleSteps[currentStepIndex + 1];
    if (!next) {
      if (settings?.meeting_requests_open && submission?.profile_complete) return delegateStepPath(eventId, 'meetings/request');
      return null;
    }
    return delegateStepPath(eventId, next);
  }, [currentStepIndex, eventId, location.pathname, settings?.meeting_requests_open, submission?.profile_complete, visibleSteps]);

  const logout = async () => {
    await supabase.auth.signOut();
    if (eventId) navigate(`/portal/${eventId}/delegate/login`, { replace: true });
  };

  if (loading) return <div className={styles.loading}>Loading your registration portal…</div>;
  if (error || !event || !settings || !submission) {
    return <div className={styles.loginWrap}><p className={styles.error}>{error || 'Portal unavailable.'}</p></div>;
  }

  if (!isStage2Active(settings, 'delegate')) {
    return <PortalHoldingScreen eventName={event.name} message={settings.stage2_holding_message} />;
  }

  const dateRange = formatEventDateRange(event.start_date, event.end_date);
  const locationLine = [event.venue, event.location].filter(Boolean).join(' — ');
  const meetingsActive = location.pathname.includes('/meetings/');

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
        <NavLink to={delegateStepPath(event.id, 'welcome')} className={({ isActive }) => (isActive && !meetingsActive ? styles.navLinkActive : styles.navLink)} end>
          Welcome
        </NavLink>
        {settings.delegate_portal_hotel_visible !== false ? (
          <NavLink to={delegateStepPath(event.id, 'hotel')} className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}>
            Hotel
          </NavLink>
        ) : null}
        <NavLink to={delegateStepPath(event.id, 'registration')} className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}>
          Registration Details
        </NavLink>
        {settings.meeting_requests_open && submission.profile_complete ? (
          <div
            className={styles.navDropdown}
            onMouseEnter={() => setMeetingsOpen(true)}
            onMouseLeave={() => setMeetingsOpen(false)}
          >
            <button type="button" className={meetingsActive ? styles.navDropdownBtnActive : styles.navDropdownBtn}>
              Meeting Requests ▾
            </button>
            {meetingsOpen ? (
              <div className={styles.navDropdownMenu}>
                <Link to={delegateStepPath(event.id, 'meetings/request')} className={styles.navDropdownItem} onClick={() => setMeetingsOpen(false)}>
                  Request Meeting
                </Link>
                <Link to={delegateStepPath(event.id, 'meetings/sent')} className={styles.navDropdownItem} onClick={() => setMeetingsOpen(false)}>
                  Sent
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className={styles.userBar}>
          <span>{userLabel}</span>
          <button type="button" className={styles.logoutBtn} onClick={() => void logout()}>
            Logout
          </button>
        </div>
      </nav>

      {!submission.profile_complete ? (
        <div className={styles.bannerHint} style={{ padding: '12px 20px', background: '#fef3c7', color: '#92400e' }}>
          Complete your profile in Registration Details to join the 1:1 matching pool.
        </div>
      ) : null}

      <main className={styles.main}>
        <Outlet context={{ event, settings, submission, reloadSubmission } satisfies DelegatePortalContext} />
      </main>

      {!location.pathname.includes('/meetings/') ? (
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
      ) : null}
    </div>
  );
}
