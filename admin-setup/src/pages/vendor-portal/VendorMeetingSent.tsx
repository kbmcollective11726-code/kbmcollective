import { useOutletContext } from 'react-router-dom';
import MeetingSentRequests from '../../components/meeting-requests/MeetingSentRequests';
import { vendorStepPath, type VendorPortalContext } from './VendorPortalLayout';

export default function VendorMeetingSent() {
  const { event, submission, settings } = useOutletContext<VendorPortalContext>();

  return (
    <MeetingSentRequests
      eventId={event.id}
      submissionId={submission.id}
      meetingRequestsOpen={settings.meeting_requests_open}
      requestPath={vendorStepPath(event.id, 'meetings/request')}
    />
  );
}
