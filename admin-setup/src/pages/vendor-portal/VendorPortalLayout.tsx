import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ACCOUNT_DEACTIVATED_MESSAGE, rejectIfAccountDeactivated } from '../../lib/accountActive';
import PortalHoldingScreen from '../../components/PortalHoldingScreen';
import PortalHeroBanner from '../../components/PortalHeroBanner';
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
import {
  clearAdminViewAs,
  currentUserCanAdminViewAs,
  displayNameFromSubmission,
  loadSubmissionForAdminViewAs,
  resolveAdminViewAs,
  writeAdminViewAs,
} from '../../lib/adminViewAs';
import AdminViewAsBanner from '../../components/AdminViewAsBanner';
import styles from '../delegate-portal/DelegatePortal.module.css';

export type VendorPortalContext = {
  event: VendorPortalEvent;
  settings: VendorPortalSettings;
  submission: EventRegistrationSubmission;
  reloadSubmission: () => Promise<void>;
  adminViewAsName?: string | null;
};

export const VENDOR_PORTAL_STEPS = ['welcome', 'hotel', 'registration', 'availability'] as const;

export function vendorStepPath(eventId: string, step: string) {
  if (step === 'meetings/request') return `/portal/${eventId}/vendor/meetings/request`;
  if (step === 'meetings/sent') return `/portal/${eventId}/vendor/meetings/sent`;
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
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [adminViewAsName, setAdminViewAsName] = useState<string | null>(null);
  const [viewAsSubmissionId, setViewAsSubmissionId] = useState<string | null>(null);

  const reloadSubmission = useCallback(async () => {
    if (!eventId) return;
    if (viewAsSubmissionId) {
      const sub = await loadSubmissionForAdminViewAs(eventId, viewAsSubmissionId, 'vendor');
      setSubmission(sub);
      return;
    }
    const sub = await linkAndLoadVendorSubmission(eventId);
    setSubmission(sub);
  }, [eventId, viewAsSubmissionId]);

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
        const userId = sessionData.session.user.id;
        const deactivated = await rejectIfAccountDeactivated(userId);
        if (deactivated) {
          navigate(`/portal/${eventId}/vendor/login`, {
            replace: true,
            state: { error: ACCOUNT_DEACTIVATED_MESSAGE },
          });
          return;
        }

        const viewAs = resolveAdminViewAs(eventId, 'vendor', location.search);
        let sub = null as EventRegistrationSubmission | null;
        let viewingAsName: string | null = null;

        if (viewAs) {
          const allowed = await currentUserCanAdminViewAs(eventId);
          if (!allowed) {
            clearAdminViewAs();
            throw new Error('Only event or platform admins can view another member\'s portal.');
          }
          sub = await loadSubmissionForAdminViewAs(eventId, viewAs.submissionId, 'vendor');
          if (!sub) {
            clearAdminViewAs();
            throw new Error('Could not load that member\'s registration for view-as.');
          }
          viewingAsName = viewAs.displayName || displayNameFromSubmission(sub);
          writeAdminViewAs({
            eventId,
            submissionId: viewAs.submissionId,
            role: 'vendor',
            displayName: viewingAsName,
          });
          if (!cancelled) setViewAsSubmissionId(viewAs.submissionId);
        } else {
          sub = await linkAndLoadVendorSubmission(eventId);
          if (!cancelled) setViewAsSubmissionId(null);
        }

        const [eventRow, settingsRow] = await Promise.all([
          loadVendorPortalEvent(eventId),
          loadVendorPortalSettings(eventId),
        ]);
        if (!eventRow) throw new Error('Event not found.');
        if (!sub) {
          navigate(`/portal/${eventId}/vendor/login`, {
            replace: true,
            state: { error: 'No submitted vendor registration found for this account.' },
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
      isStage2Active(settings, 'vendor') &&
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
    if (location.pathname.includes('/meetings/')) return vendorStepPath(eventId, 'registration');
    return vendorStepPath(eventId, visibleSteps[currentStepIndex - 1] ?? 'welcome');
  }, [currentStepIndex, eventId, location.pathname, visibleSteps]);

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
        return vendorStepPath(eventId, 'meetings/request');
      }
      return null;
    }
    return vendorStepPath(eventId, next);
  }, [currentStepIndex, eventId, location.pathname, settings?.meeting_requests_open, submission?.matching_opt_in, submission?.profile_complete, visibleSteps]);

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

  const stage2Active = isStage2Active(settings, 'vendor');
  const dateRange = formatEventDateRange(event.start_date, event.end_date);
  const locationLine = [event.venue, event.location].filter(Boolean).join(' — ');
  const registrationPath = vendorStepPath(event.id, 'registration');
  const meetingsActive = location.pathname.includes('/meetings/');
  const availabilityActive = location.pathname.endsWith('/availability');
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
          to={vendorStepPath(event.id, 'welcome')}
          className={({ isActive }) =>
            isActive && !meetingsActive && !showHoldingMain ? styles.navLinkActive : styles.navLink
          }
          end
        >
          Welcome
        </NavLink>
        {stage2Active && settings.delegate_portal_hotel_visible !== false ? (
          <NavLink to={vendorStepPath(event.id, 'hotel')} className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}>
            Hotel
          </NavLink>
        ) : null}
        <NavLink
          to={registrationPath}
          className={({ isActive }) => (isActive && !meetingsActive ? styles.navLinkActive : styles.navLink)}
        >
          Registration Details
        </NavLink>
        {stage2Active && submission.profile_complete && submission.matching_opt_in ? (
          <NavLink
            to={vendorStepPath(event.id, 'availability')}
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
                <Link
                  to={vendorStepPath(event.id, 'meetings/request')}
                  className={styles.navDropdownItem}
                  onClick={() => setMeetingsOpen(false)}
                >
                  Request Meeting
                </Link>
                <Link
                  to={vendorStepPath(event.id, 'meetings/sent')}
                  className={styles.navDropdownItem}
                  onClick={() => setMeetingsOpen(false)}
                >
                  Sent
                </Link>
                {settings.portal_received_requests_visible ? (
                  <Link
                    to={vendorStepPath(event.id, 'meetings/received')}
                    className={styles.navDropdownItem}
                    onClick={() => setMeetingsOpen(false)}
                  >
                    Received
                  </Link>
                ) : null}
                <Link
                  to={vendorStepPath(event.id, 'meetings/times')}
                  className={styles.navDropdownItem}
                  onClick={() => setMeetingsOpen(false)}
                >
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
          Complete your profile below to join the 1:1 matching pool.
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
            roleLabel="vendor"
          />
        ) : (
          <Outlet context={{ event, settings, submission, reloadSubmission } satisfies VendorPortalContext} />
        )}
      </main>

      <footer className={styles.footerNav}>
        {!location.pathname.includes('/meetings/') ? (
          stage2Active ? (
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
              <Link to={vendorStepPath(event.id, 'welcome')} className={styles.footerBtn}>← Welcome</Link>
              <span className={styles.footerBtnDisabled}>Next →</span>
            </>
          ) : (
            <>
              <span className={styles.footerBtnDisabled}>← Previous</span>
              <Link to={registrationPath} className={styles.footerBtn}>Registration Details →</Link>
            </>
          )
        ) : null}
      </footer>
      </div>
    </div>
  );
}
