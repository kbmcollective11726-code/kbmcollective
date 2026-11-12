import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { isCurrentUserPlatformAdmin } from '../lib/fetchAdminEvents';
import OwaspAsvsScorecard from '../components/OwaspAsvsScorecard';
import styles from './PlatformUserAudit.module.css';

/** Dedicated OWASP ASVS scorecard page (platform admins only). */
export default function PlatformOwaspAsvs() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    isCurrentUserPlatformAdmin().then((ok) => {
      if (!cancelled) setAllowed(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (allowed === null) {
    return (
      <div className={styles.page}>
        <p className={styles.hint}>Checking access…</p>
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.page}>
      <Link to="/platform/audit" className={styles.back}>
        ← Security audit
      </Link>
      <h1>OWASP security score</h1>
      <p className={styles.hint}>
        Enterprise readiness from the latest OWASP ASVS 5.0 audit. Click a category tile to see why
        it scored that way. Day-to-day account monitoring stays on{' '}
        <Link to="/platform/audit">Security audit</Link>.
      </p>
      <OwaspAsvsScorecard />
    </div>
  );
}
