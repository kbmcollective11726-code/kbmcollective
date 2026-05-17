import { useEffect, useState } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import EventContextBar, { JoinEventButton } from './EventContextBar';
import EventAdminTileGuard from './EventAdminTileGuard';
import styles from './Layout.module.css';

export default function Layout() {
  const navigate = useNavigate();
  const [platformAdmin, setPlatformAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isCurrentUserPlatformAdmin().then((v) => {
      if (!cancelled) setPlatformAdmin(v);
    });
    return () => { cancelled = true; };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link to="/" className={styles.brand}>
          <img src="/logo.png" alt="KBM Connect" className={styles.logoImg} />
          <span className={styles.logoText}>Admin Console</span>
        </Link>
        <nav className={styles.sideNav}>
          <Link to="/">All events</Link>
          {platformAdmin ? <Link to="/platform/users">All users</Link> : null}
          {platformAdmin ? <Link to="/platform/test-guide">Test guide</Link> : null}
          <span className={styles.sideNavJoin}>
            <JoinEventButton />
          </span>
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
