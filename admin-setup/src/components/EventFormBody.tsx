import { useRef } from 'react';
import type { EventFormFields } from '../lib/eventFormState';
import styles from '../pages/EventForm.module.css';

export type BannerUploadProps = {
  uploadingBanner: boolean;
  onBannerFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearBanner: () => void;
  /** Saved banner URL or a temporary object URL for a file chosen before the event exists. */
  bannerPreviewSrc: string;
};

type Props = {
  form: EventFormFields;
  setForm: React.Dispatch<React.SetStateAction<EventFormFields>>;
  bannerUpload: BannerUploadProps;
  /** When false, Live wall visibility is read-only (only platform admins may change it). */
  canEditLiveWallMenu?: boolean;
};

export default function EventFormBody({
  form,
  setForm,
  bannerUpload,
  canEditLiveWallMenu = true,
}: Props) {
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const patch = (partial: Partial<EventFormFields>) => {
    setForm((s) => ({ ...s, ...partial }));
  };

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
      <p className={styles.fieldHint}>Event banner — shown at the top of the in-app Info screen. Upload a JPG or PNG (stored like the mobile app).</p>
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/*"
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
            <button
              type="button"
              className={styles.clearBtn}
              disabled={bannerUpload.uploadingBanner}
              onClick={bannerUpload.onClearBanner}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <h2 className={styles.sectionTitle}>In-app menu (KBM hamburger)</h2>
      <p className={styles.fieldHint}>
        Uncheck to hide these links from the side menu. <strong>Agenda</strong> also controls the Agenda tab in the
        bottom bar when off. <strong>Notes</strong> is only shown to event admins and vendor booth reps; uncheck to hide
        it for them too.
      </p>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={form.menuShowAgenda}
          onChange={(e) => patch({ menuShowAgenda: e.target.checked })}
        />
        <span>Show <strong>Agenda</strong></span>
      </label>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={form.menuShow1on1}
          onChange={(e) => patch({ menuShow1on1: e.target.checked })}
        />
        <span>Show <strong>1:1 Meetings</strong></span>
      </label>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={form.menuShowScanBadge}
          onChange={(e) => patch({ menuShowScanBadge: e.target.checked })}
        />
        <span>Show <strong>Scan badge</strong></span>
      </label>
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={form.menuShowNotes}
          onChange={(e) => patch({ menuShowNotes: e.target.checked })}
        />
        <span>Show <strong>Notes</strong></span>
      </label>
      <label className={`${styles.checkboxLabel} ${!canEditLiveWallMenu ? styles.checkboxDisabled : ''}`}>
        <input
          type="checkbox"
          checked={form.menuShowLiveWall}
          disabled={!canEditLiveWallMenu}
          onChange={(e) => patch({ menuShowLiveWall: e.target.checked })}
        />
        <span>Show <strong>Live wall</strong></span>
      </label>
      {!canEditLiveWallMenu ? (
        <p className={styles.fieldHint}>
          Only platform administrators can show or hide the Live wall link in the mobile app menu and the web admin top
          bar.
        </p>
      ) : null}
      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={form.menuShowSolutionProviders}
          onChange={(e) => patch({ menuShowSolutionProviders: e.target.checked })}
        />
        <span>Show <strong>Solution Provider</strong></span>
      </label>

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
