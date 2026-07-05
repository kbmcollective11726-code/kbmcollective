import styles from '../pages/delegate-portal/DelegatePortal.module.css';

interface Props {
  eventName: string;
  dateRange?: string | null;
  locationLine?: string | null;
}

export default function PortalEventSummary({ eventName, dateRange, locationLine }: Props) {
  return (
    <div className={styles.eventSummary}>
      <h1 className={styles.eventSummaryName}>{eventName}</h1>
      {(dateRange || locationLine) ? (
        <dl className={styles.eventSummaryMeta}>
          {dateRange ? (
            <div className={styles.eventSummaryRow}>
              <dt>When</dt>
              <dd>{dateRange}</dd>
            </div>
          ) : null}
          {locationLine ? (
            <div className={styles.eventSummaryRow}>
              <dt>Where</dt>
              <dd>{locationLine}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
