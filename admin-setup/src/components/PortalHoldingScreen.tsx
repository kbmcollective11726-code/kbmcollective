import styles from '../pages/delegate-portal/DelegatePortal.module.css';

interface Props {
  eventName?: string;
  message?: string | null;
}

export default function PortalHoldingScreen({ eventName, message }: Props) {
  return (
    <div className={styles.loginWrap}>
      <div className={styles.loginCard}>
        <h1>{eventName ? eventName : 'Registration confirmed'}</h1>
        <p className={styles.hint}>
          {message?.trim() ||
            'Your registration is confirmed! Full profile setup opens soon — we will email you when it is ready.'}
        </p>
      </div>
    </div>
  );
}
