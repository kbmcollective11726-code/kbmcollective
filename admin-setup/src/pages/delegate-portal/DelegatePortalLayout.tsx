import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ACCOUNT_DEACTIVATED_MESSAGE, rejectIfAccountDeactivated } from '../../lib/accountActive';
import PortalHoldingScreen from '../../components/PortalHoldingScreen';
import PortalHeroBanner from '../../components/PortalHeroBanner';
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
import {
  clearAdminViewAs,
  currentUserCanAdminViewAs,
  displayNameFromSubmission,
  loadSubmissionForAdminViewAs,
  resolveAdminViewAs,
  writeAdminViewAs,
} from '../../lib/adminViewAs';
import AdminViewAsBanner from '../../components/AdminViewAsBanner';
import styles from './DelegatePortal.module.css';

export type DelegatePortalContext = {
  event: DelegatePortalEvent;
  settings: DelegatePortalSettings;
  submission: EventRegistrationSubmission;
  reloadSubmission: () => Promise<void>;
  /** When set, admin is viewing this member’s portal (read-only intent). */
  adminViewAsName?: string | null;
};

export const DELEGATE_PORTAL_STEPS = ['welcome', 'hotel', 'registration', 'availability', 'meetings'] as const;

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
  const [adminViewAsName, setAdminViewAsName] = useState<string | null>(null);
  const [viewAsSubmissionId, setViewAsSubmissionId] = useState<string | null>(null);

  const reloadSubmission = useCallback(async () => {
    if (!eventId) return;
    if (viewAsSubmissionId) {
      const sub = await loadSubmissionForAdminViewAs(eventId, viewAsSubmissionId, 'delegate');
      setSubmission(sub);
      return;
    }
    const sub = await linkAndLoadDelegateSubmission(eventId);
    setSubmission(sub);
  }, [eventId, viewAsSubmissionId]);

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
        const userId = sessionData.session.user.id;
        const deactivated = await rejectIfAccountDeactivated(userId);
        if (deactivated) {
          navigate(`/portal/${eventId}/delegate/login`, {
            replace: true,
            state: { error: ACCOUNT_DEACTIVATED_MESSAGE },
          });
          return;
        }

        const viewAs = resolveAdminViewAs(eventId, 'delegate', location.search);
        let sub: EventRegistrationSubmission | null = null;
        let viewingAsName: string | null = null;

        if (viewAs) {
          const allowed = await currentUserCanAdminViewAs(eventId);
          if (!allowed) {
            clearAdminViewAs();
            throw new Error('Only event or platform admins can view another member’s portal.');
          }
          sub = await loadSubmissionForAdminViewAs(eventId, viewAs.submissionId, 'delegate');
          if (!sub) {
            clearAdminViewAs();
            throw new Error('Could not load that member’s registration for view-as.');
          }
          viewingAsName = viewAs.displayName || displayNameFromSubmission(sub);
          writeAdminViewAs({
            eventId,
            submissionId: viewAs.submissionId,
            role: 'delegate',
            displayName: viewingAsName,
          });
          if (!cancelled) setViewAsSubmissionId(viewAs.submissionId);
        } else {
          sub = await linkAndLoadDelegateSubmission(eventId);
          if (!cancelled) setViewAsSubmissionId(null);
        }

        const [eventRow, settingsRow] = await Promise.all([
          loadDelegatePortalEvent(eventId),
          loadDelegatePortalSettings(eventId),
        ]);
        if (!eventRow) throw new Error('Event not found.');
        if (!sub) {
          navigate(`/portal/${eventId}/delegate/login`, {
            replace: true,
            state: { error: 'No submitted registration found for this account.' },
          });
          return;
        }
        if (sub.registration_status === 'rejected' && !viewingAsName) {
          throw new Error('Your registration was not approved. Contact the event organizer.');
        }
        const profileEmail = sessionData.session.user.email ?? '';
        const name =
          viewingAsName ||
          [sub.first_name, sub.last_name].filter(Boolean).join(' ') ||
          profileEmail;
        if (!cancelled) {
          setEvent(eventRow);
          setSettings(settingsRow);
          setSubmission(sub);
          setUserLabel(name);
          setAdminViewAsName(viewingAsName);
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
  }, [eventId, navigate, location.search]);

  const exitAdminViewAs = () => {
    clearAdminViewAs();
    setAdminViewAsName(null);
    setViewAsSubmissionId(null);
    if (eventId) navigate(`/events/${eventId}/members`, { replace: true });
  };

  const visibleSteps = useMemo(() => {
    const steps: string[] = ['welcome'];
    if (settings?.delegate_portal_hotel_visible !== false) steps.push('hotel');
    steps.push('registration');
    if (
      settings &&
      isStage2Active(settings, 'delegate') &&
      submission?.profile_complete &&
      submission.matching_opt_in
    ) {
      steps.push('availability');
    }
    return steps;
  }, [settings, submission?.matching_opt_in, submission?.profile_complete]);

  const currentStepIndex = useMemo(() => {
    const path = location.pathname;
    if (path.includes('/meetings/')) return visibleSteps.length;
    if (path.endsWith('/availability')) return visibleSteps.indexOf('availability');
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
      if (
        settings?.meeting_requests_open &&
        submission?.profile_complete &&
        submission.matching_opt_in
      ) {
        return delegateStepPath(eventId, 'meetings/request');
      }
      return null;
    }
    return delegateStepPath(eventId, next);
  }, [currentStepIndex, eventId, location.pathname, settings?.meeting_requests_open, submission?.matching_opt_in, submission?.profile_complete, visibleSteps]);

  const logout = async () => {
    await supabase.auth.signOut();
    if (eventId) navigate(`/portal/${eventId}/delegate/login`, { replace: true });
  };

  if (loading) return <div className={styles.loading}>Loading your registration portal…</div>;
  if (error || !event || !settings || !submission) {
    return <div className={styles.loginWrap}><p className={styles.error}>{error || 'Portal unavailable.'}</p></div>;
  }

  const stage2Active = isStage2Active(settings, 'delegate');
  const dateRange = formatEventDateRange(event.start_date, event.end_date);
  const locationLine = [event.venue, event.location].filter(Boolean).join(' — ');
  const meetingsActive = location.pathname.includes('/meetings/');
  const availabilityActive = location.pathname.endsWith('/availability');
  const registrationPath = delegateStepPath(event.id, 'registration');
  const onRegistrationRoute =
    location.pathname.endsWith('/registration') ||
    location.pathname.endsWith('/hotel') ||
    availabilityActive ||
    location.pathname.includes('/meetings/');
  const showHoldingMain = !stage2Active && onRegistrationRoute;

  return (
    <div className={styles.page}>
      {adminViewAsName ? (
        <AdminViewAsBanner memberName={adminViewAsName} onExit={exitAdminViewAs} />
      ) : null}
      <div className={styles.portalFrame}>
      <PortalHeroBanner event={event} />

      <nav className={styles.navBar}>
        <NavLink
          to={delegateStepPath(event.id, 'welcome')}
          className={({ isActive }) =>
            isActive && !meetingsActive && !showHoldingMain ? styles.navLinkActive : styles.navLink
          }
          end
        >
          Welcome
        </NavLink>
        {stage2Active && settings.delegate_portal_hotel_visible !== false ? (
          <NavLink to={delegateStepPath(event.id, 'hotel')} className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}>
            Hotel
          </NavLink>
        ) : null}
        {stage2Active ? (
          <NavLink to={registrationPath} className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}>
            Registration Details
          </NavLink>
        ) : (
          <NavLink
            to={registrationPath}
            className={({ isActive }) => (isActive || showHoldingMain ? styles.navLinkActive : styles.navLink)}
          >
            Registration Details
          </NavLink>
        )}
        {stage2Active && submission.profile_complete && submission.matching_opt_in ? (
          <NavLink
            to={delegateStepPath(event.id, 'availability')}
            className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}
          >
            1-on-1 Availability
          </NavLink>
        ) : null}
        {stage2Active && submission.profile_complete && submission.matching_opt_in ? (
          <div
            className={styles.navDropdown}
            onMouseEnter={() => setMeetingsOpen(true)}
            onMouseLeave={() => setMeetingsOpen(false)}
          >
            <button
              type="button"
              className={meetingsActive ? styles.navDropdownBtnActive : styles.navDropdownBtn}
              aria-expanded={meetingsOpen}
              onClick={() => setMeetingsOpen((open) => !open)}
            >
              Meetings ▾
            </button>
            {meetingsOpen ? (
              <div className={styles.navDropdownMenu}>
                <Link to={delegateStepPath(event.id, 'meetings/request')} className={styles.navDropdownItem} onClick={() => setMeetingsOpen(false)}>
                  Request Meeting
                </Link>
                <Link to={delegateStepPath(event.id, 'meetings/sent')} className={styles.navDropdownItem} onClick={() => setMeetingsOpen(false)}>
                  Sent
                </Link>
                {settings.portal_received_requests_visible ? (
                  <Link to={delegateStepPath(event.id, 'meetings/received')} className={styles.navDropdownItem} onClick={() => setMeetingsOpen(false)}>
                    Received
                  </Link>
                ) : null}
                <Link to={delegateStepPath(event.id, 'meetings/times')} className={styles.navDropdownItem} onClick={() => setMeetingsOpen(false)}>
                  Meeting Times
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className={styles.userBar}>
          <span>{userLabel}</span>
          <button type="button" className={styles.logoutBtn} onClick={adminViewAsName ? exitAdminViewAs : () => void logout()}>
            Logout
          </button>
        </div>
      </nav>

      {!stage2Active ? (
        <div className={styles.stage2Banner}>
          Registration details are not open yet — your organizer will email you when you can complete your profile.
        </div>
      ) : !submission.profile_complete ? (
        <div className={styles.bannerHint} style={{ padding: '12px 20px', background: '#fef3c7', color: '#92400e' }}>
          Complete your profile in Registration Details to join the 1:1 matching pool.
        </div>
      ) : null}

      <main className={styles.main}>
        {showHoldingMain ? (
          <PortalHoldingScreen
            eventName={event.name}
            dateRange={dateRange}
            locationLine={locationLine || null}
            userName={userLabel}
            message={settings.stage2_holding_message}
            expectedOpenAt={settings.stage2_expected_open_at}
            roleLabel="delegate"
          />
        ) : (
          <Outlet context={{ event, settings, submission, reloadSubmission } satisfies DelegatePortalContext} />
        )}
      </main>

      {!location.pathname.includes('/meetings/') ? (
        <footer className={styles.footerNav}>
          {stage2Active ? (
            <>
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
            </>
          ) : showHoldingMain ? (
            <>
              <Link to={delegateStepPath(event.id, 'welcome')} className={styles.footerBtn}>← Welcome</Link>
              <span className={styles.footerBtnDisabled}>Next →</span>
            </>
          ) : (
            <>
              <span className={styles.footerBtnDisabled}>← Previous</span>
              <Link to={registrationPath} className={styles.footerBtn}>Registration Details →</Link>
            </>
          )}
        </footer>
      ) : null}
      </div>
    </div>
  );
}
