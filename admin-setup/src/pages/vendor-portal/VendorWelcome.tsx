import { useOutletContext } from 'react-router-dom';
import { formatEventDateRange } from '../../lib/vendorPortal';
import type { VendorPortalContext } from './VendorPortalLayout';
import styles from '../delegate-portal/DelegatePortal.module.css';

export default function VendorWelcome() {
  const { event } = useOutletContext<VendorPortalContext>();
  const dateRange = formatEventDateRange(event.start_date, event.end_date);
  const welcomeText = event.welcome_message || event.description || '';

  return (
    <div className={styles.card}>
      <h1>Welcome</h1>
      {event.welcome_title ? <h2>{event.welcome_title}</h2> : null}
      {welcomeText ? <div className={styles.contentBlock}>{welcomeText}</div> : null}
      {!welcomeText ? (
        <p className={styles.hint}>
          Thank you for registering as a vendor for {event.name}
          {dateRange ? ` (${dateRange})` : ''}.
        </p>
      ) : null}
      <p className={styles.hint} style={{ marginTop: 20 }}>
        Use the menu above or the <strong>Next</strong> button below to review and update your vendor profile for 1:1 matching.
      </p>
    </div>
  );
}
