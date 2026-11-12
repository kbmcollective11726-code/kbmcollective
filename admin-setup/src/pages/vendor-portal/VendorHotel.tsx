import { useOutletContext } from 'react-router-dom';
import PortalRichHtml from '../../components/PortalRichHtml';
import { formatEventDateRange } from '../../lib/vendorPortal';
import { hasRichTextContent } from '../../lib/sanitizeHtml';
import type { VendorPortalContext } from './VendorPortalLayout';
import styles from '../delegate-portal/DelegatePortal.module.css';

export default function VendorHotel() {
  const { event, settings } = useOutletContext<VendorPortalContext>();
  const dateRange = formatEventDateRange(event.start_date, event.end_date);
  const custom = hasRichTextContent(settings.delegate_hotel_content);

  return (
    <div className={styles.card}>
      <h1>Hotel</h1>
      {custom ? <PortalRichHtml html={settings.delegate_hotel_content} className={styles.richHtml} /> : null}
      {!custom ? (
        <>
          {event.venue ? (
            <p>
              <strong>Venue:</strong> {event.venue}
            </p>
          ) : null}
          {event.location ? (
            <p>
              <strong>Location:</strong> {event.location}
            </p>
          ) : null}
          {dateRange ? (
            <p>
              <strong>Event dates:</strong> {dateRange}
            </p>
          ) : null}
          <p className={styles.hint}>
            Hotel and stay details for this event will appear here. Your event organizer can add specific reservation instructions in
            Matchmaking setup.
          </p>
        </>
      ) : null}
    </div>
  );
}
