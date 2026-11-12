import {
  displayNameFromSubmission,
  findSubmissionForMemberViewAs,
  openAdminViewAsPortal,
  portalRoleFromAttendeeType,
  portalRoleFromMemberRoles,
} from './adminViewAs';

export {
  clearAdminViewAs,
  currentUserCanAdminViewAs,
  displayNameFromSubmission,
  findSubmissionForMemberViewAs,
  loadSubmissionForAdminViewAs,
  openAdminViewAsPortal,
  portalRoleFromAttendeeType,
  portalRoleFromMemberRoles,
  resolveAdminViewAs,
  writeAdminViewAs,
  type AdminViewAsState,
  type PortalViewAsRole,
} from './adminViewAs';

/** Open portal as a registrant (admin stays signed in). */
export async function openPortalViewAsSubmission(params: {
  eventId: string;
  submissionId: string;
  attendeeType: string | null | undefined;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  companyName?: string | null;
  page?: 'welcome' | 'registration';
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const role = portalRoleFromAttendeeType(params.attendeeType);
  if (!role) {
    return { ok: false, message: 'View as is only available for delegates and vendors.' };
  }
  openAdminViewAsPortal(
    {
      eventId: params.eventId,
      submissionId: params.submissionId,
      role,
      displayName: displayNameFromSubmission({
        first_name: params.firstName,
        last_name: params.lastName,
        email: params.email,
        company_name: params.companyName,
      }),
    },
    params.page ?? 'welcome',
  );
  return { ok: true };
}

/** Open portal as an event member (looks up their registration). */
export async function openPortalViewAsMember(params: {
  eventId: string;
  userId: string;
  role: string | null | undefined;
  roles: string[] | null | undefined;
  fullName?: string | null;
  email?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const portalRole = portalRoleFromMemberRoles(params.role, params.roles);
  if (!portalRole) {
    return { ok: false, message: 'View as is only available for delegates and vendors.' };
  }
  const sub = await findSubmissionForMemberViewAs(params.eventId, params.userId, portalRole);
  if (!sub) {
    return {
      ok: false,
      message:
        'No matching registration found for this member. Try View as from Matchmaking → Registrations.',
    };
  }
  openAdminViewAsPortal({
    eventId: params.eventId,
    submissionId: sub.id,
    role: portalRole,
    displayName:
      params.fullName?.trim() || displayNameFromSubmission(sub) || params.email || 'Member',
  });
  return { ok: true };
}
