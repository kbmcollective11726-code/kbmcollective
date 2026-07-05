import { useOutletContext } from 'react-router-dom';
import PortalEventSummary from '../../components/PortalEventSummary';
import { formatEventDateRange } from '../../lib/vendorPortal';
import type { VendorPortalContext } from './VendorPortalLayout';
import styles from '../delegate-portal/DelegatePortal.module.css';

export default function VendorWelcome() {
  const { event, settings } = useOutletContext<VendorPortalContext>();
  const dateRange = formatEventDateRange(event.start_date, event.end_date);
  const locationLine = [event.venue, event.location].filter(Boolean).join(' — ');
  const welcomeText = event.welcome_message || event.description || '';
  const stage2Active = settings.vendor_stage2_active;

  return (
    <div className={styles.card}>
      <PortalEventSummary eventName={event.name} dateRange={dateRange} locationLine={locationLine || null} />
      <h2 className={styles.welcomeHeading}>{event.welcome_title || 'Welcome'}</h2>
      {welcomeText ? <div className={styles.contentBlock}>{welcomeText}</div> : null}
      {!welcomeText ? (
        <p className={styles.hint}>Thank you for registering as a vendor. We look forward to connecting you with delegates.</p>
      ) : null}
      <p className={styles.hint} style={{ marginTop: 20 }}>
        {stage2Active
          ? 'Use the menu above or the Next button below to review and update your vendor profile for 1:1 matching.'
          : 'Registration details are not open yet. Use Registration Details above to see when your vendor profile will be available.'}
      </p>
    </div>
  );
}
