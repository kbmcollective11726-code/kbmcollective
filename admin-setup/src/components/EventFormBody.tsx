import { useMemo, useRef } from 'react';
import type { EventFormFields } from '../lib/eventFormState';
import {
  EVENT_ADMIN_APP_MENU_TOGGLES,
  EVENT_ADMIN_MENU_FORM_FIELD,
  platformMenuFromEvent,
  type PlatformMenuDraft,
} from '../lib/eventExperienceControls';
import type { Event } from '../lib/types';
import { BANNER_FILE_ACCEPT, EVENT_BANNER_HINT, EVENT_BANNER_SIZE_LABEL } from '../lib/eventBannerHints';
import { EVENT_TIMEZONE_OPTIONS } from '../lib/eventTimezones';
import styles from '../pages/EventForm.module.css';

export type BannerUploadProps = {
  uploadingBanner: boolean;
  onBannerFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearBanner: () => void;
  /** Re-letterbox saved banner to 1200×750 (Edit event only). */
  onRefitBanner?: () => void;
  /** Saved banner URL or a temporary object URL for a file chosen before the event exists. */
  bannerPreviewSrc: string;
};

type Props = {
  form: EventFormFields;
  setForm: React.Dispatch<React.SetStateAction<EventFormFields>>;
  bannerUpload: BannerUploadProps;
  /** When set (Edit event), show in-app menu toggles allowed by the platform. */
  eventForPlatformMenu?: Event | null;
};

export default function EventFormBody({
  form,
  setForm,
  bannerUpload,
  eventForPlatformMenu,
}: Props) {
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const patch = (partial: Partial<EventFormFields>) => {
    setForm((s) => ({ ...s, ...partial }));
  };

  const platformMenu: PlatformMenuDraft | null = eventForPlatformMenu
    ? platformMenuFromEvent(eventForPlatformMenu)
    : null;

  const appMenuToggles = useMemo(() => {
    if (!platformMenu) return [];
    return EVENT_ADMIN_APP_MENU_TOGGLES.filter((t) => platformMenu[t.platformKey]);
  }, [platformMenu]);

  return (
    <>
      <h2 className={styles.sectionTitle}>Basics</h2>
      <label className={styles.label}>
        Event name *
        <input
          type="text"
          value={form.name}
          onChange={(e) => patch({ name: e.target.value })}
          required
          className={styles.input}
          placeholder="e.g. Front Office Summit 2026"
        />
      </label>
      <label className={styles.label}>
        Description
        <textarea
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          className={styles.textarea}
          rows={2}
        />
      </label>
      <label className={styles.label}>
        Location
        <input
          type="text"
          value={form.location}
          onChange={(e) => patch({ location: e.target.value })}
          className={styles.input}
          placeholder="Address or city"
        />
      </label>
      <label className={styles.label}>
        Venue
        <input
          type="text"
          value={form.venue}
          onChange={(e) => patch({ venue: e.target.value })}
          className={styles.input}
          placeholder="e.g. Westgate Resort"
        />
      </label>
      <label className={styles.label}>
        Event timezone
        <select
          value={form.reminderTimezone}
          onChange={(e) => patch({ reminderTimezone: e.target.value })}
          className={styles.input}
        >
          {EVENT_TIMEZONE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className={styles.fieldHint}>
          Venue wall-clock for the agenda, Live now badge, and session starting-soon reminders (~5 min before).
        </span>
      </label>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={form.vendorBriefEnabled}
          onChange={(e) => patch({ vendorBriefEnabled: e.target.checked })}
        />
        <span>
          <strong>Vendor "Prior interactions" history</strong>
          <span className={styles.menuItemDesc}>
            Shows vendors/admins whether their company has met an attendee at a past event (prior meetings &amp;
            notes), in the pre-meeting brief. Turn off to hide this history for this event. Vendors can still open
            the brief and add notes either way. Attendees never see it.
          </span>
        </span>
      </label>
      <label className={styles.label}>
        Event code (optional)
        <input
          type="text"
          value={form.eventCode}
          onChange={(e) => patch({ eventCode: e.target.value })}
          className={styles.input}
          placeholder="e.g. SUMMIT26 — leave blank for auto"
        />
      </label>
      <div className={styles.row}>
        <label className={styles.label}>
          Start date *
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => patch({ startDate: e.target.value })}
            required
            className={styles.input}
          />
        </label>
        <label className={styles.label}>
          End date *
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => patch({ endDate: e.target.value })}
            required
            className={styles.input}
          />
        </label>
      </div>

      <h2 className={styles.sectionTitle}>Branding</h2>
      <label className={styles.label}>
        Theme color
        <input
          type="color"
          value={form.themeColor}
          onChange={(e) => patch({ themeColor: e.target.value })}
          className={styles.colorInput}
        />
      </label>
      <p className={styles.fieldHint}>{EVENT_BANNER_HINT}</p>
      <p className={styles.bannerSizeCallout}>
        Recommended size: <strong>{EVENT_BANNER_SIZE_LABEL}</strong> (8:5 wide). Other wide images are auto-fitted on upload.
      </p>
      <input
        ref={bannerInputRef}
        type="file"
        accept={BANNER_FILE_ACCEPT}
        className={styles.hiddenFile}
        onChange={bannerUpload.onBannerFile}
        aria-hidden
      />
      <div className={styles.mediaRow}>
        <div className={styles.mediaPreview}>
          {bannerUpload.bannerPreviewSrc ? (
            <img src={bannerUpload.bannerPreviewSrc} alt="Banner preview" className={styles.bannerThumb} />
          ) : (
            <div className={styles.mediaPlaceholder}>
              {bannerUpload.uploadingBanner ? 'Uploading…' : 'No banner'}
            </div>
          )}
        </div>
        <div className={styles.mediaActions}>
          <button
            type="button"
            className={styles.uploadBtn}
            disabled={bannerUpload.uploadingBanner}
            onClick={() => bannerInputRef.current?.click()}
          >
            {bannerUpload.uploadingBanner
              ? 'Uploading…'
              : bannerUpload.bannerPreviewSrc
                ? 'Replace banner'
                : 'Upload banner'}
          </button>
          {bannerUpload.bannerPreviewSrc ? (
            <>
              {bannerUpload.onRefitBanner ? (
                <button
                  type="button"
                  className={styles.uploadBtn}
                  disabled={bannerUpload.uploadingBanner}
                  onClick={bannerUpload.onRefitBanner}
                >
                  {bannerUpload.uploadingBanner ? 'Working…' : 'Re-fit for app'}
                </button>
              ) : null}
              <button
                type="button"
                className={styles.clearBtn}
                disabled={bannerUpload.uploadingBanner}
                onClick={bannerUpload.onClearBanner}
              >
                Remove
              </button>
            </>
          ) : null}
        </div>
      </div>

      {appMenuToggles.length > 0 ? (
        <>
          <h2 className={styles.sectionTitle}>In-app menu (mobile)</h2>
          <p className={styles.fieldHint}>
            Turn items on or off for attendees in the KBM app. Only options your platform admin enabled appear
            here.
          </p>
          {appMenuToggles.map((item) => {
            const field = EVENT_ADMIN_MENU_FORM_FIELD[item.id];
            if (!field) return null;
            return (
              <label key={item.id} className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form[field]}
                  onChange={(e) => patch({ [field]: e.target.checked } as Partial<EventFormFields>)}
                />
                <span>
                  <strong>{item.title}</strong>
                  <span className={styles.menuItemDesc}>{item.desc}</span>
                </span>
              </label>
            );
          })}
        </>
      ) : null}

      <h2 className={styles.sectionTitle}>Info page (home screen)</h2>
      <p className={styles.fieldHint}>These fields power the in-app Info / home content (same as the mobile admin Info page).</p>
      <label className={styles.label}>
        Welcome title
        <input
          type="text"
          value={form.welcomeTitle}
          onChange={(e) => patch({ welcomeTitle: e.target.value })}
          className={styles.input}
        />
      </label>
      <label className={styles.label}>
        Welcome subtitle
        <input
          type="text"
          value={form.welcomeSubtitle}
          onChange={(e) => patch({ welcomeSubtitle: e.target.value })}
          className={styles.input}
        />
      </label>
      <div className={styles.heroStatsRow}>
        <label className={styles.heroStatItem}>
          Hero stat 1
          <input
            type="text"
            value={form.heroStat1}
            onChange={(e) => patch({ heroStat1: e.target.value })}
            className={styles.input}
          />
        </label>
        <label className={styles.heroStatItem}>
          Hero stat 2
          <input
            type="text"
            value={form.heroStat2}
            onChange={(e) => patch({ heroStat2: e.target.value })}
            className={styles.input}
          />
        </label>
        <label className={styles.heroStatItem}>
          Hero stat 3
          <input
            type="text"
            value={form.heroStat3}
            onChange={(e) => patch({ heroStat3: e.target.value })}
            className={styles.input}
          />
        </label>
      </div>
      <label className={styles.label}>
        Arrival day text
        <textarea
          value={form.arrivalDayText}
          onChange={(e) => patch({ arrivalDayText: e.target.value })}
          className={styles.textarea}
          rows={2}
        />
      </label>
      <label className={styles.label}>
        Summit / main days text
        <textarea
          value={form.summitDaysText}
          onChange={(e) => patch({ summitDaysText: e.target.value })}
          className={styles.textarea}
          rows={2}
        />
      </label>
      <label className={styles.label}>
        Theme text
        <textarea
          value={form.themeText}
          onChange={(e) => patch({ themeText: e.target.value })}
          className={styles.textarea}
          rows={2}
        />
      </label>
      <label className={styles.label}>
        What to expect (one line per bullet)
        <textarea
          value={form.whatToExpectText}
          onChange={(e) => patch({ whatToExpectText: e.target.value })}
          className={styles.textarea}
          rows={4}
          placeholder={'Line 1\nLine 2'}
        />
      </label>
      <label className={styles.label}>
        Points section intro
        <textarea
          value={form.pointsSectionIntro}
          onChange={(e) => patch({ pointsSectionIntro: e.target.value })}
          className={styles.textarea}
          rows={2}
        />
      </label>
    </>
  );
}
