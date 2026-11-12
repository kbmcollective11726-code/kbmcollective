import { useOutletContext } from 'react-router-dom';
import MeetingRequestBrowse from '../../components/meeting-requests/MeetingRequestBrowse';
import { delegateStepPath, type DelegatePortalContext } from './DelegatePortalLayout';

export default function DelegateMeetingRequest() {
  const { event, submission, settings } = useOutletContext<DelegatePortalContext>();

  return (
    <MeetingRequestBrowse
      eventId={event.id}
      submissionId={submission.id}
      viewerRole="delegate"
      meetingRequestsOpen={settings.meeting_requests_open}
      matchSuggestionsEnabled={settings.portal_match_suggestions_delegates_enabled}
      sentPath={delegateStepPath(event.id, 'meetings/sent')}
    />
  );
}
