import { supabase } from './supabase';

export type SponsorClickPlacement =
  | 'info'
  | 'feed'
  | 'schedule'
  | 'hamburger_header'
  | 'hamburger_footer'
  | 'live_wall';

/** Log a sponsor logo tap after the website opened successfully. */
export async function logSponsorClick(params: {
  eventId: string;
  sponsorId: string;
  placement: SponsorClickPlacement;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return;

  const { error } = await supabase.from('event_sponsor_clicks').insert({
    event_id: params.eventId,
    sponsor_id: params.sponsorId,
    user_id: user.id,
    placement: params.placement,
  });
  if (error && __DEV__) {
    console.warn('[logSponsorClick]', error.message);
  }
}
