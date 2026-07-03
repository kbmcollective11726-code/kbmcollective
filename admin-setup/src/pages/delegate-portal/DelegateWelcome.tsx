import { useOutletContext } from 'react-router-dom';
import { formatEventDateRange } from '../../lib/delegatePortal';
import type { DelegatePortalContext } from './DelegatePortalLayout';
import styles from './DelegatePortal.module.css';

export default function DelegateWelcome() {
  const { event } = useOutletContext<DelegatePortalContext>();
  const dateRange = formatEventDateRange(event.start_date, event.end_date);
  const welcomeText = event.welcome_message || event.description || '';

  return (
    <div className={styles.card}>
      <h1>Welcome</h1>
      {event.welcome_title ? <h2>{event.welcome_title}</h2> : null}
      {welcomeText ? <div className={styles.contentBlock}>{welcomeText}</div> : null}
      {!welcomeText ? (
        <p className={styles.hint}>
          Thank you for registering for {event.name}
          {dateRange ? ` (${dateRange})` : ''}.
        </p>
      ) : null}
      <p className={styles.hint} style={{ marginTop: 20 }}>
        Use the menu above or the <strong>Next</strong> button below to review hotel information, update your registration details,
        and submit meeting requests when your event organizer enables them.
      </p>
    </div>
  );
}
