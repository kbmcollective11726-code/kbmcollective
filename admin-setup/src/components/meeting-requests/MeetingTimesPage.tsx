import { useOutletContext } from 'react-router-dom';
import type { RegistrantPortalContext } from '../../lib/registrantPortal';
import MeetingTimes from './MeetingTimes';

export default function MeetingTimesPage() {
  const { event, submission } = useOutletContext<RegistrantPortalContext>();
  return <MeetingTimes eventId={event.id} submissionId={submission.id} />;
}
