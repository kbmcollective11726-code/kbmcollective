import { useOutletContext } from 'react-router-dom';
import type { RegistrantPortalContext } from '../../lib/registrantPortal';
import MeetingReceivedRequests from './MeetingReceivedRequests';

export default function MeetingReceivedPage() {
  const { event, submission, settings } = useOutletContext<RegistrantPortalContext>();
  return (
    <MeetingReceivedRequests
      eventId={event.id}
      submissionId={submission.id}
      meetingRequestsOpen={settings.meeting_requests_open}
      receivedRequestsVisible={settings.portal_received_requests_visible}
    />
  );
}
