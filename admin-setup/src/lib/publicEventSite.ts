import { supabase } from './supabase';

export interface PublicSiteSpeaker {
  name?: string | null;
  title?: string | null;
  company?: string | null;
  photo?: string | null;
}

export interface PublicSiteSession {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  day_number: number | null;
  location: string | null;
  room: string | null;
  track: string | null;
  session_type: string | null;
  speakers: PublicSiteSpeaker[] | null;
  speaker_name: string | null;
  speaker_title: string | null;
  speaker_photo: string | null;
}

export interface PublicSiteSpeakerProfile {
  bio: string | null;
  avatar_url: string | null;
  title: string | null;
  company: string | null;
}

export interface PublicSiteSponsor {
  id: string;
  company_name: string;
  logo_url: string | null;
  website_url: string | null;
  tier_label: string | null;
}

export interface PublicSiteFaqItem {
  question: string;
  answer: string;
}

export interface PublicSiteEvent {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  venue: string | null;
  map_url: string | null;
  start_date: string | null;
  end_date: string | null;
  banner_url: string | null;
  portal_banner_url: string | null;
  logo_url: string | null;
  theme_color: string | null;
  welcome_title: string | null;
  welcome_subtitle: string | null;
  welcome_message: string | null;
  reminder_timezone: string | null;
}

/** Site exists but the website is turned off, or the event is no longer active. */
export interface PublicEventSiteUnavailable {
  status: 'off' | 'inactive';
  slug: string;
  event: Pick<PublicSiteEvent, 'id' | 'name' | 'logo_url' | 'theme_color'>;
}

export interface PublicEventSiteData {
  status: 'live';
  slug: string;
  event: PublicSiteEvent;
  registration_open: boolean;
  form_id: string | null;
  sessions: PublicSiteSession[];
  speaker_profiles: Record<string, PublicSiteSpeakerProfile>;
  sponsors: PublicSiteSponsor[];
  faq: PublicSiteFaqItem[];
}

export async function loadPublicEventSite(
  slug: string,
): Promise<PublicEventSiteData | PublicEventSiteUnavailable | null> {
  const { data, error } = await supabase.rpc('get_public_event_site', { p_slug: slug });
  if (error) throw error;
  if (!data) return null;
  const raw = data as { status?: string };
  if (raw.status === 'off' || raw.status === 'inactive') return data as PublicEventSiteUnavailable;
  const site = data as PublicEventSiteData;
  return {
    ...site,
    status: 'live',
    sessions: Array.isArray(site.sessions) ? site.sessions : [],
    sponsors: Array.isArray(site.sponsors) ? site.sponsors : [],
    faq: Array.isArray(site.faq) ? site.faq.filter((f) => f?.question?.trim()) : [],
    speaker_profiles: site.speaker_profiles ?? {},
  };
}

/** Speakers on a session: the speakers list, or the legacy single-speaker columns. */
export function sessionSpeakers(session: PublicSiteSession): PublicSiteSpeaker[] {
  const list = (session.speakers ?? []).filter((s) => s?.name?.trim());
  if (list.length > 0) return list;
  if (session.speaker_name?.trim()) {
    return [{ name: session.speaker_name, title: session.speaker_title, photo: session.speaker_photo }];
  }
  return [];
}

export function speakerKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

/** Session times are venue wall clock stored as UTC; read the UTC parts. */
export function formatWallClockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

export function wallClockDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function formatDayHeading(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function formatEventDateRange(start: string | null, end: string | null): string {
  if (!start) return '';
  const opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  const s = new Date(`${start}T12:00:00Z`);
  if (Number.isNaN(s.getTime())) return '';
  if (!end || end === start) return s.toLocaleDateString('en-US', opts);
  const e = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(e.getTime())) return s.toLocaleDateString('en-US', opts);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const sameMonth = sameYear && s.getUTCMonth() === e.getUTCMonth();
  if (sameMonth) {
    return `${s.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })} ${s.getUTCDate()}–${e.getUTCDate()}, ${e.getUTCFullYear()}`;
  }
  const startText = s.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
  return `${startText} – ${e.toLocaleDateString('en-US', opts)}`;
}

export function eventMapHref(event: PublicSiteEvent): string | null {
  const custom = event.map_url?.trim();
  if (custom && /^https?:\/\//i.test(custom)) return custom;
  const query = [event.venue, event.location].filter((p) => p?.trim()).join(', ');
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function safeHttpUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}
