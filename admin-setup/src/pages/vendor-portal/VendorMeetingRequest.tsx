import { useOutletContext } from 'react-router-dom';
import MeetingRequestBrowse from '../../components/meeting-requests/MeetingRequestBrowse';
import { vendorStepPath, type VendorPortalContext } from './VendorPortalLayout';

export default function VendorMeetingRequest() {
  const { event, submission, settings } = useOutletContext<VendorPortalContext>();

  return (
    <MeetingRequestBrowse
      eventId={event.id}
      submissionId={submission.id}
      viewerRole="vendor"
      meetingRequestsOpen={settings.meeting_requests_open}
      sentPath={vendorStepPath(event.id, 'meetings/sent')}
    />
  );
}
