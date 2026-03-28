import { Outlet, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EventContextBar, { JoinEventButton } from './EventContextBar';
import styles from './Layout.module.css';

export default function Layout() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <Link to="/" className={styles.logoWrap}>
            <img src="/logo.png" alt="KBM Connect" className={styles.logoImg} />
            <span className={styles.logoText}>Admin</span>
          </Link>
          <EventContextBar />
          <nav className={styles.nav}>
            <Link to="/">All events</Link>
            <span className={styles.navJoinWrap}>
              <JoinEventButton />
            </span>
            <button type="button" onClick={handleLogout} className={styles.logout}>
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        Built by operators. Trusted across industries. — <a href="https://kbmcollective.org" target="_blank" rel="noopener noreferrer">KBM Collective</a>
      </footer>
    </div>
  );
}
