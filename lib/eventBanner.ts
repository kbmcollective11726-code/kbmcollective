/**
 * Info hero on the app — May 2026 layout used 16:10 full-bleed + cover.
 * Upload: keep aspect ratio (recommended 1600×1000 or 1200×600 wide JPG).
 */
export const INFO_BANNER_DISPLAY_ASPECT = 16 / 10; // 1.6 — matches old Info screen

/** Optional letterbox target if you use Re-fit for app in cadmin. */
export const EVENT_BANNER_WIDTH = 1200;
export const EVENT_BANNER_HEIGHT = 750;
export const EVENT_BANNER_STANDARD_ASPECT = EVENT_BANNER_WIDTH / EVENT_BANNER_HEIGHT;

/** @deprecated Use INFO_BANNER_DISPLAY_ASPECT for the app hero slot */
export const EVENT_BANNER_DEFAULT_ASPECT = INFO_BANNER_DISPLAY_ASPECT;

export const EVENT_BANNER_LETTERBOX_BG = '#0c1f3d';

/** Fixed 16:10 hero height — always use this on the Info screen. */
export function infoBannerHeightForWidth(screenWidth: number): number {
  return Math.round(screenWidth / INFO_BANNER_DISPLAY_ASPECT);
}

/** @deprecated Use infoBannerHeightForWidth */
export function eventBannerHeightForWidth(screenWidth: number): number {
  return infoBannerHeightForWidth(screenWidth);
}

