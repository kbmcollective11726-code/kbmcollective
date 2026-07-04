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

export type VendorPortalSettings = RegistrantPortalSettings;
export type VendorPortalEvent = RegistrantPortalEvent;

export {
  formatEventDateRange,
  isStage2Active,
  DEFAULT_HOLDING_MESSAGE,
  registrantStepPath,
};

export async function loadVendorPortalSettings(eventId: string): Promise<VendorPortalSettings | null> {
  return loadRegistrantPortalSettings(eventId);
}

export async function loadVendorPortalEvent(eventId: string): Promise<VendorPortalEvent | null> {
  return loadRegistrantPortalEvent(eventId);
}

export async function linkAndLoadVendorSubmission(eventId: string) {
  return linkAndLoadRegistrantSubmission(eventId, 'vendor');
}

export async function userHasVendorPortalAccess(eventId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_submitted_vendor_registration', { p_event_id: eventId });
  if (error) throw error;
  return Boolean(data);
}
