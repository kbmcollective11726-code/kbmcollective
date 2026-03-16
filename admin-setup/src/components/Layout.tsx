import { Outlet, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
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
        <Link to="/" className={styles.logoWrap}>
          <img src="/logo.png" alt="KBM Connect" className={styles.logoImg} />
          <span className={styles.logoText}>Admin</span>
        </Link>
        <nav className={styles.nav}>
          <Link to="/">Events</Link>
          <button type="button" onClick={handleLogout} className={styles.logout}>
            Sign out
          </button>
        </nav>
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
