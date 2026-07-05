import { Navigate, Route } from 'react-router-dom';
import DelegateLogin from './pages/DelegateLogin';
import VendorLogin from './pages/VendorLogin';
import DelegatePortalLayout from './pages/delegate-portal/DelegatePortalLayout';
import DelegateWelcome from './pages/delegate-portal/DelegateWelcome';
import DelegateHotel from './pages/delegate-portal/DelegateHotel';
import DelegateRegistrationDetails from './pages/delegate-portal/DelegateRegistrationDetails';
import DelegateMeetingRequest from './pages/delegate-portal/DelegateMeetingRequest';
import DelegateMeetingSent from './pages/delegate-portal/DelegateMeetingSent';
import DelegateSetPassword from './pages/delegate-portal/DelegateSetPassword';
import VendorPortalLayout from './pages/vendor-portal/VendorPortalLayout';
import VendorWelcome from './pages/vendor-portal/VendorWelcome';
import VendorRegistrationDetails from './pages/vendor-portal/VendorRegistrationDetails';
import VendorMeetingRequest from './pages/vendor-portal/VendorMeetingRequest';
import VendorMeetingSent from './pages/vendor-portal/VendorMeetingSent';
import VendorSetPassword from './pages/vendor-portal/VendorSetPassword';
import RegistrationPortal from './pages/RegistrationPortal';

/** Route elements for registration + delegate/vendor portal (no cadmin MFA). */
export function portalRouteElements() {
  return (
    <>
      <Route path="/register/:eventId/:audience" element={<RegistrationPortal />} />
      <Route path="/portal/:eventId/delegate/login" element={<DelegateLogin />} />
      <Route path="/portal/:eventId/delegate/set-password" element={<DelegateSetPassword />} />
      <Route path="/portal/:eventId/delegate" element={<DelegatePortalLayout />}>
        <Route index element={<Navigate to="welcome" replace />} />
        <Route path="welcome" element={<DelegateWelcome />} />
        <Route path="hotel" element={<DelegateHotel />} />
        <Route path="registration" element={<DelegateRegistrationDetails />} />
        <Route path="meetings/request" element={<DelegateMeetingRequest />} />
        <Route path="meetings/sent" element={<DelegateMeetingSent />} />
      </Route>
      <Route path="/portal/:eventId/vendor/login" element={<VendorLogin />} />
      <Route path="/portal/:eventId/vendor/set-password" element={<VendorSetPassword />} />
      <Route path="/portal/:eventId/vendor" element={<VendorPortalLayout />}>
        <Route index element={<Navigate to="welcome" replace />} />
        <Route path="welcome" element={<VendorWelcome />} />
        <Route path="registration" element={<VendorRegistrationDetails />} />
        <Route path="meetings/request" element={<VendorMeetingRequest />} />
        <Route path="meetings/sent" element={<VendorMeetingSent />} />
      </Route>
    </>
  );
}
