import type { Event } from './types';

/** Client-side shape for create / edit event forms (matches app `Event` DB fields). */
export type EventFormFields = {
  name: string;
  description: string;
  location: string;
  venue: string;
  startDate: string;
  endDate: string;
  eventCode: string;
  themeColor: string;
  /** Set from DB / after banner upload (not typed in). */
  bannerUrl: string;
  welcomeTitle: string;
  welcomeSubtitle: string;
  heroStat1: string;
  heroStat2: string;
  heroStat3: string;
  arrivalDayText: string;
  summitDaysText: string;
  themeText: string;
  whatToExpectText: string;
  pointsSectionIntro: string;
  contactPhone: string;
  /** KBM hamburger: show 1:1 Meetings */
  menuShow1on1: boolean;
  /** KBM hamburger: show Live wall */
  menuShowLiveWall: boolean;
  /** KBM hamburger: show Solution Provider */
  menuShowSolutionProviders: boolean;
  /** KBM hamburger: show Scan badge */
  menuShowScanBadge: boolean;
  /** KBM hamburger: show Notes (admins / vendor reps) */
  menuShowNotes: boolean;
  /** KBM hamburger: show Agenda */
  menuShowAgenda: boolean;
};

export function toYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function defaultEventFormFields(startDate: string, endDate: string): EventFormFields {
  return {
    name: '',
    description: '',
    location: '',
    venue: '',
    startDate,
    endDate,
    eventCode: '',
    themeColor: '#2563eb',
    bannerUrl: '',
    welcomeTitle: '',
    welcomeSubtitle: '',
    heroStat1: '',
    heroStat2: '',
    heroStat3: '',
    arrivalDayText: '',
    summitDaysText: '',
    themeText: '',
    whatToExpectText: '',
    pointsSectionIntro: '',
    contactPhone: '',
    menuShow1on1: true,
    menuShowLiveWall: true,
    menuShowSolutionProviders: true,
    menuShowScanBadge: true,
    menuShowNotes: true,
    menuShowAgenda: true,
  };
}

function parseWhatToExpect(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((x): x is string => typeof x === 'string');
  return [];
}

export function eventFormFieldsFromEvent(e: Event): EventFormFields {
  const list = parseWhatToExpect(e.what_to_expect);
  return {
    name: e.name,
    description: e.description ?? '',
    location: e.location ?? '',
    venue: e.venue ?? '',
    startDate: e.start_date ?? '',
    endDate: e.end_date ?? '',
    eventCode: e.event_code ?? '',
    themeColor: e.theme_color ?? '#2563eb',
    bannerUrl: e.banner_url ?? '',
    welcomeTitle: e.welcome_title ?? '',
    welcomeSubtitle: e.welcome_subtitle ?? '',
    heroStat1: e.hero_stat_1 ?? '',
    heroStat2: e.hero_stat_2 ?? '',
    heroStat3: e.hero_stat_3 ?? '',
    arrivalDayText: e.arrival_day_text ?? '',
    summitDaysText: e.summit_days_text ?? '',
    themeText: e.theme_text ?? '',
    whatToExpectText: list.join('\n'),
    pointsSectionIntro: e.points_section_intro ?? '',
    contactPhone: e.contact_phone ?? '',
    menuShow1on1: e.menu_show_1on1 !== false,
    menuShowLiveWall: e.menu_show_live_wall !== false,
    menuShowSolutionProviders: e.menu_show_solution_providers !== false,
    menuShowScanBadge: e.menu_show_scan_badge !== false,
    menuShowNotes: e.menu_show_notes !== false,
    menuShowAgenda: e.menu_show_agenda !== false,
  };
}

function whatToExpectFromText(text: string): string[] | null {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  return lines.length ? lines : null;
}

/**
 * Row for `events` insert (caller adds created_by, is_active, etc.).
 * Omits welcome_message, wifi_info, map_url so web admin does not overwrite values managed in the mobile app.
 */
export function eventInsertRowFromForm(f: EventFormFields) {
  const customCode = f.eventCode.trim() ? f.eventCode.trim().toUpperCase() : null;
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    location: f.location.trim() || null,
    venue: f.venue.trim() || null,
    start_date: f.startDate.trim(),
    end_date: f.endDate.trim(),
    theme_color: f.themeColor.trim() || '#2563eb',
    event_code: customCode,
    welcome_title: f.welcomeTitle.trim() || null,
    welcome_subtitle: f.welcomeSubtitle.trim() || null,
    hero_stat_1: f.heroStat1.trim() || null,
    hero_stat_2: f.heroStat2.trim() || null,
    hero_stat_3: f.heroStat3.trim() || null,
    arrival_day_text: f.arrivalDayText.trim() || null,
    summit_days_text: f.summitDaysText.trim() || null,
    theme_text: f.themeText.trim() || null,
    what_to_expect: whatToExpectFromText(f.whatToExpectText),
    points_section_intro: f.pointsSectionIntro.trim() || null,
    contact_phone: f.contactPhone.trim() || null,
    menu_show_1on1: f.menuShow1on1,
    menu_show_live_wall: f.menuShowLiveWall,
    menu_show_solution_providers: f.menuShowSolutionProviders,
    menu_show_scan_badge: f.menuShowScanBadge,
    menu_show_notes: f.menuShowNotes,
    menu_show_agenda: f.menuShowAgenda,
  };
}

/**
 * Row for `events` update (caller adds updated_at).
 * Omits welcome_message, wifi_info, map_url so Save does not clear them when they were set outside web admin.
 */
export function eventUpdateRowFromForm(
  f: EventFormFields,
  fallbackEventCode: string | null,
  options?: { omitMenuLiveWall?: boolean; omitMenuShowNotes?: boolean }
) {
  const customCode = f.eventCode.trim() ? f.eventCode.trim().toUpperCase() : null;
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    location: f.location.trim() || null,
    venue: f.venue.trim() || null,
    start_date: f.startDate.trim(),
    end_date: f.endDate.trim(),
    theme_color: f.themeColor.trim() || '#2563eb',
    event_code: customCode ?? fallbackEventCode ?? null,
    banner_url: f.bannerUrl.trim() || null,
    welcome_title: f.welcomeTitle.trim() || null,
    welcome_subtitle: f.welcomeSubtitle.trim() || null,
    hero_stat_1: f.heroStat1.trim() || null,
    hero_stat_2: f.heroStat2.trim() || null,
    hero_stat_3: f.heroStat3.trim() || null,
    arrival_day_text: f.arrivalDayText.trim() || null,
    summit_days_text: f.summitDaysText.trim() || null,
    theme_text: f.themeText.trim() || null,
    what_to_expect: whatToExpectFromText(f.whatToExpectText),
    points_section_intro: f.pointsSectionIntro.trim() || null,
    contact_phone: f.contactPhone.trim() || null,
    menu_show_1on1: f.menuShow1on1,
    ...(options?.omitMenuLiveWall ? {} : { menu_show_live_wall: f.menuShowLiveWall }),
    menu_show_solution_providers: f.menuShowSolutionProviders,
    menu_show_scan_badge: f.menuShowScanBadge,
    ...(options?.omitMenuShowNotes ? {} : { menu_show_notes: f.menuShowNotes }),
    menu_show_agenda: f.menuShowAgenda,
  };
}
