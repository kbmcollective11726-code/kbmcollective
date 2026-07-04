import { supabase } from './supabase';
import {
  type RegistrantPortalEvent,
  type RegistrantPortalSettings,
  formatEventDateRange,
  isStage2Active,
  loadRegistrantPortalEvent,
  loadRegistrantPortalSettings,
  linkAndLoadRegistrantSubmission,
  DEFAULT_HOLDING_MESSAGE,
  registrantStepPath,
} from './registrantPortal';

export type DelegatePortalSettings = RegistrantPortalSettings;
export type DelegatePortalEvent = RegistrantPortalEvent;

export {
  formatEventDateRange,
  isStage2Active,
  DEFAULT_HOLDING_MESSAGE,
  registrantStepPath,
};

export async function loadDelegatePortalSettings(eventId: string): Promise<DelegatePortalSettings | null> {
  return loadRegistrantPortalSettings(eventId);
}

export async function loadDelegatePortalEvent(eventId: string): Promise<DelegatePortalEvent | null> {
  return loadRegistrantPortalEvent(eventId);
}

export async function linkAndLoadDelegateSubmission(eventId: string) {
  return linkAndLoadRegistrantSubmission(eventId, 'delegate');
}

export async function userHasDelegatePortalAccess(eventId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_submitted_delegate_registration', { p_event_id: eventId });
  if (error) throw error;
  return Boolean(data);
}
