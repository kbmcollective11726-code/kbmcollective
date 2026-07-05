import PortalEventSummary from './PortalEventSummary';
import styles from '../pages/delegate-portal/DelegatePortal.module.css';
import { DEFAULT_HOLDING_MESSAGE } from '../lib/registrantPortal';

interface Props {
  eventName: string;
  dateRange?: string | null;
  locationLine?: string | null;
  userName?: string;
  message?: string | null;
  expectedOpenAt?: string | null;
  roleLabel?: 'delegate' | 'vendor';
}

function formatExpectedOpen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function PortalHoldingScreen({
  eventName,
  dateRange,
  locationLine,
  userName,
  message,
  expectedOpenAt,
  roleLabel = 'delegate',
}: Props) {
  const roleName = roleLabel === 'vendor' ? 'vendor' : 'delegate';
  const customMessage = message?.trim();
  const hasExpectedOpen = Boolean(expectedOpenAt?.trim());
  const greeting = userName?.trim() ? `Hi ${userName.trim()},` : null;

  return (
    <div className={styles.card}>
      <PortalEventSummary eventName={eventName} dateRange={dateRange} locationLine={locationLine} />
      <h2 className={styles.welcomeHeading}>Registration Details</h2>
      {greeting ? <p className={styles.holdingGreeting}>{greeting}</p> : null}
      <p className={styles.hint}>{customMessage || DEFAULT_HOLDING_MESSAGE}</p>
      {hasExpectedOpen ? (
        <p className={styles.holdingSchedule}>
          <strong>Expected to open:</strong> {formatExpectedOpen(expectedOpenAt!.trim())}
        </p>
      ) : (
        <p className={styles.holdingSchedule}>
          Your event organizer has not released the full {roleName} registration profile yet. We will email you
          when it is ready to complete.
        </p>
      )}
      <p className={styles.hint}>
        You are signed in. Visit <strong>Welcome</strong> for event information, then return here once registration
        details are open.
      </p>
    </div>
  );
}
