import { useEffect, useState } from 'react';
import { Outlet, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import { clearPlatformAdminEmailOtp } from '../lib/platformAdminEmailOtp';
import { clearAwaitingPlatformAdminEmailOtp } from '../pages/LoginEmailCode';
import EventContextBar, { JoinEventButton } from './EventContextBar';
import EventAdminTileGuard from './EventAdminTileGuard';
import SidebarNavIcon from './SidebarNavIcon';
import SecurityAttentionBanner from './SecurityAttentionBanner';
import styles from './Layout.module.css';

const SIDEBAR_PREF_KEY = 'cadmin.sidebarCollapsed';

function isMatchmakingPath(pathname: string): boolean {
  return /\/events\/[^/]+\/matchmaking(?:\/|$)/.test(pathname);
}

function readSidebarPref(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSidebarPref(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_PREF_KEY, collapsed ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const onMatchmaking = isMatchmakingPath(location.pathname);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [userLabel, setUserLabel] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => onMatchmaking || readSidebarPref());

  useEffect(() => {
    if (onMatchmaking) {
      setSidebarCollapsed(true);
      return;
    }
    setSidebarCollapsed(readSidebarPref());
  }, [onMatchmaking]);

  useEffect(() => {
    let cancelled = false;
    isCurrentUserPlatformAdmin().then((v) => {
      if (!cancelled) setPlatformAdmin(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadUserLabel = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setUserLabel('');
        return;
      }
      const { data: profile } = await supabase
        .from('users')
        .select('full_name, email')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = profile as { full_name?: string | null; email?: string | null } | null;
      const name = row?.full_name?.trim();
      const email = row?.email?.trim() || user.email?.trim();
      setUserLabel(name || email || 'Signed in');
    };

    loadUserLabel();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadUserLabel();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    clearPlatformAdminEmailOtp();
    clearAwaitingPlatformAdminEmailOtp();
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      if (!onMatchmaking) writeSidebarPref(next);
      return next;
    });
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink;

  return (
    <div className={`${styles.shell} ${sidebarCollapsed ? styles.shellSidebarCollapsed : ''}`}>
      <aside className={styles.sidebar} aria-hidden={sidebarCollapsed}>
        <div className={styles.sidebarTop}>
          <Link to="/" className={styles.brand}>
            <img src="/logo-sidebar.png" alt="KBM Connect" className={styles.logoImg} />
            <span className={styles.logoText}>Admin Console</span>
            {userLabel ? <span className={styles.userName}>{userLabel}</span> : null}
          </Link>
          <button
            type="button"
            className={styles.sidebarCollapseBtn}
            onClick={toggleSidebar}
            aria-label="Close sidebar"
            title="Close sidebar"
          >
            «
          </button>
        </div>
        <div className={styles.brandDivider} aria-hidden />
        <nav className={styles.sideNav} aria-label="Main">
          <p className={styles.navLabel}>Menu</p>
          <NavLink to="/" end className={navClass}>
            <span className={styles.navLinkInner}>
              <SidebarNavIcon name="events" />
              All events
            </span>
          </NavLink>
          <NavLink to="/troubleshooting" className={navClass}>
            <span className={styles.navLinkInner}>
              <SidebarNavIcon name="help" />
              Troubleshooting
            </span>
          </NavLink>
          {platformAdmin ? (
            <NavLink to="/platform/health" className={navClass}>
              <span className={styles.navLinkInner}>
                <SidebarNavIcon name="health" />
                App health
              </span>
            </NavLink>
          ) : null}
          {platformAdmin ? (
            <NavLink to="/platform/users" className={navClass}>
              <span className={styles.navLinkInner}>
                <SidebarNavIcon name="users" />
                All users
              </span>
            </NavLink>
          ) : null}
          {platformAdmin ? (
            <NavLink to="/platform/audit" className={navClass}>
              <span className={styles.navLinkInner}>
                <SidebarNavIcon name="audit" />
                Security audit
              </span>
            </NavLink>
          ) : null}
          {platformAdmin ? (
            <NavLink to="/platform/owasp" className={navClass}>
              <span className={styles.navLinkInner}>
                <SidebarNavIcon name="owasp" />
                OWASP score
              </span>
            </NavLink>
          ) : null}
          {platformAdmin ? (
            <NavLink to="/platform/test-guide" className={navClass}>
              <span className={styles.navLinkInner}>
                <SidebarNavIcon name="guide" />
                Test guide
              </span>
            </NavLink>
          ) : null}
          {platformAdmin ? (
            <NavLink to="/platform/compute" className={navClass}>
              <span className={styles.navLinkInner}>
                <SidebarNavIcon name="compute" />
                Compute guide
              </span>
            </NavLink>
          ) : null}
          <div className={styles.sideNavJoin}>
            <JoinEventButton />
          </div>
        </nav>
      </aside>

      <div className={styles.contentArea}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.sidebarOpenBtn}
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? 'Open menu' : 'Close menu'}
          >
            {sidebarCollapsed ? '☰ Menu' : '« Menu'}
          </button>
          <EventContextBar />
          <button type="button" onClick={handleLogout} className={styles.logout}>
            Sign out
          </button>
        </header>

        <main className={styles.main}>
          {platformAdmin ? <SecurityAttentionBanner enabled={platformAdmin} /> : null}
          <EventAdminTileGuard>
            <Outlet />
          </EventAdminTileGuard>
        </main>

        <footer className={styles.footer}>
          Built by operators. Trusted across industries. —{' '}
          <a href="https://kbmcollective.org" target="_blank" rel="noopener noreferrer">
            KBM Collective
          </a>
        </footer>
      </div>
    </div>
  );
}
