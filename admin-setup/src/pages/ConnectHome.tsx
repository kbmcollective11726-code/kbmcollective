import { CADMIN_HOST } from '../lib/connectHost';
import styles from './ConnectHome.module.css';

export default function ConnectHome() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>KBM Collective</p>
        <h1 className={styles.title}>Connect</h1>
        <p className={styles.lead}>
          Registration and attendee portals for KBM events. Open the link from your invitation email to
          register or sign in.
        </p>
        <ul className={styles.list}>
          <li>Delegates and vendors register at event-specific links</li>
          <li>After approval, sign in to complete your profile and meetings</li>
          <li>Set-password links from email also start on this site</li>
        </ul>
        <a className={styles.adminLink} href={`https://${CADMIN_HOST}/login`}>
          Event organizer? Sign in to the admin console
        </a>
      </div>
    </div>
  );
}
