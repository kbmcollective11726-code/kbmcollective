import PortalEventSummary from './PortalEventSummary';
import PortalRichHtml from './PortalRichHtml';
import styles from '../pages/delegate-portal/DelegatePortal.module.css';
import { holdingScheduleMessageForRole } from '../lib/registrantPortal';
import { hasRichTextContent } from '../lib/sanitizeHtml';

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
  const hasCustomMessage = hasRichTextContent(message);
  const hasExpectedOpen = Boolean(expectedOpenAt?.trim());
  const greeting = userName?.trim() ? `Hi ${userName.trim()},` : null;

  return (
    <div className={styles.card}>
      <PortalEventSummary eventName={eventName} dateRange={dateRange} locationLine={locationLine} />
      <h2 className={styles.welcomeHeading}>Registration Details</h2>
      {greeting ? <p className={styles.holdingGreeting}>{greeting}</p> : null}
      {hasCustomMessage ? (
        <PortalRichHtml html={message} className={styles.richHtml} />
      ) : (
        <>
          <p className={styles.holdingLead}>
            <span className={styles.holdingLeadAccent}>Your registration is confirmed!</span>
            <br />
            Full profile setup opens soon — we will email you when it is ready.
          </p>
          {!hasExpectedOpen ? (
            <p className={styles.holdingSchedule}>{holdingScheduleMessageForRole(roleLabel)}</p>
          ) : null}
        </>
      )}
      {hasExpectedOpen ? (
        <p className={styles.holdingSchedule}>
          <strong>Expected to open:</strong> {formatExpectedOpen(expectedOpenAt!.trim())}
        </p>
      ) : null}
      <p className={styles.hint}>
        You are signed in. Visit <strong>Welcome</strong> for event information, then return here once registration
        details are open.
      </p>
    </div>
  );
}
