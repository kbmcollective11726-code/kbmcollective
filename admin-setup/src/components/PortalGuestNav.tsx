import { Link } from 'react-router-dom';
import { publicPortalLoginUrl, publicRegisterUrl } from '../lib/publicPortalUrl';
import styles from '../pages/delegate-portal/DelegatePortal.module.css';

export type PortalGuestNavTab = 'welcome' | 'registration' | 'login';

interface Props {
  eventId: string;
  role: 'delegate' | 'vendor';
  activeTab: PortalGuestNavTab;
}

export default function PortalGuestNav({ eventId, role, activeTab }: Props) {
  const registerAudience = role === 'delegate' ? 'delegate' : 'vendor';
  const loginHref = publicPortalLoginUrl(eventId, role);

  return (
    <nav className={styles.navBar}>
      {activeTab === 'welcome' ? (
        <span className={styles.navLinkActive}>Welcome</span>
      ) : (
        <Link to={publicRegisterUrl(eventId, registerAudience)} className={styles.navLink}>
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
