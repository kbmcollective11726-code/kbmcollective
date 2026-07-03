import { useEffect, useState } from 'react';
import { Outlet, Link, NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import EventContextBar, { JoinEventButton } from './EventContextBar';
import EventAdminTileGuard from './EventAdminTileGuard';
import SidebarNavIcon from './SidebarNavIcon';
import styles from './Layout.module.css';

export default function Layout() {
  const navigate = useNavigate();
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [userLabel, setUserLabel] = useState('');

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
    await supabase.auth.signOut();
    navigate('/login');
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link to="/" className={styles.brand}>
          <img src="/logo-sidebar.png" alt="KBM Connect" className={styles.logoImg} />
          <span className={styles.logoText}>Admin Console</span>
          {userLabel ? <span className={styles.userName}>{userLabel}</span> : null}
        </Link>
        <div className={styles.brandDivider} aria-hidden />
        <nav className={styles.sideNav} aria-label="Main">
          <p className={styles.navLabel}>Menu</p>
          <NavLink to="/" end className={navClass}>
            <span className={styles.navLinkInner}>
              <SidebarNavIcon name="events" />
              All events
            </span>
          </NavLink>
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
            <NavLink to="/platform/test-guide" className={navClass}>
              <span className={styles.navLinkInner}>
                <SidebarNavIcon name="guide" />
                Test guide
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
          <EventContextBar />
          <button type="button" onClick={handleLogout} className={styles.logout}>
            Sign out
          </button>
        </header>

        <main className={styles.main}>
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
