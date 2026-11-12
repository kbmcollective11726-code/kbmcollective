import { Link } from 'react-router-dom';
import { publicPortalLoginUrl, publicRegisterUrl } from '../lib/publicPortalUrl';
import styles from '../pages/delegate-portal/DelegatePortal.module.css';

export type PortalGuestNavTab = 'welcome' | 'registration' | 'login';

interface Props {
  eventId: string;
  role: 'delegate' | 'vendor';
  activeTab: PortalGuestNavTab;
  /** When set, Welcome returns to this track's public register URL. */
  formSlug?: string | null;
}

export default function PortalGuestNav({ eventId, role, activeTab, formSlug }: Props) {
  const registerAudience = role === 'delegate' ? 'delegate' : 'vendor';
  const loginHref = publicPortalLoginUrl(eventId, role);
  const welcomeHref = publicRegisterUrl(eventId, registerAudience, formSlug);

  return (
    <nav className={styles.navBar}>
      {activeTab === 'welcome' ? (
        <span className={styles.navLinkActive}>Welcome</span>
      ) : (
        <Link to={welcomeHref} className={styles.navLink}>
          Welcome
        </Link>
      )}
      {activeTab === 'registration' ? (
        <span className={styles.navLinkActive}>Registration Details</span>
      ) : (
        <span className={styles.navLinkDisabled}>Registration Details</span>
      )}
      <div className={styles.userBar}>
        {activeTab === 'login' ? (
          <span className={styles.navUserName}>Sign in</span>
        ) : (
          <Link to={loginHref} className={styles.logoutBtn}>
            Login
          </Link>
        )}
      </div>
    </nav>
  );
}
