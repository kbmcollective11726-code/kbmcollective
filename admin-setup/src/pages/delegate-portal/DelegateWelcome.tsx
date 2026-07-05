import { useOutletContext } from 'react-router-dom';
import PortalEventSummary from '../../components/PortalEventSummary';
import { formatEventDateRange } from '../../lib/delegatePortal';
import type { DelegatePortalContext } from './DelegatePortalLayout';
import styles from './DelegatePortal.module.css';

export default function DelegateWelcome() {
  const { event, settings } = useOutletContext<DelegatePortalContext>();
  const dateRange = formatEventDateRange(event.start_date, event.end_date);
  const locationLine = [event.venue, event.location].filter(Boolean).join(' — ');
  const welcomeText = event.welcome_message || event.description || '';
  const stage2Active = settings.delegate_stage2_active;

  return (
    <div className={styles.card}>
      <PortalEventSummary eventName={event.name} dateRange={dateRange} locationLine={locationLine || null} />
      <h2 className={styles.welcomeHeading}>{event.welcome_title || 'Welcome'}</h2>
      {welcomeText ? <div className={styles.contentBlock}>{welcomeText}</div> : null}
      {!welcomeText ? (
        <p className={styles.hint}>Thank you for registering. We are glad you are joining us.</p>
      ) : null}
      <p className={styles.hint} style={{ marginTop: 20 }}>
        {stage2Active
          ? 'Use the menu above or the Next button below to review hotel information, update your registration details, and submit meeting requests when your event organizer enables them.'
          : 'Registration details are not open yet. Use Registration Details above to see when your profile will be available, and check your email for updates from the organizer.'}
      </p>
    </div>
  );
}
