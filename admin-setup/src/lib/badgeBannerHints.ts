/** Printed badge header strip — 3.75″ wide × 1.52″ tall at 300 DPI. */

export const BADGE_BANNER_WIDTH = 1125;
export const BADGE_BANNER_HEIGHT = 456;

export const BADGE_BANNER_ASPECT = BADGE_BANNER_WIDTH / BADGE_BANNER_HEIGHT;

export const BADGE_BANNER_SIZE_LABEL = `${BADGE_BANNER_WIDTH}×${BADGE_BANNER_HEIGHT} px`;

export const BADGE_BANNER_HINT =
  'Wide strip for the top of printed badges (recommended 1125×456 or similar ~2.5:1). ' +
  'Upload scales to full badge width; extra space only appears above/below if the image is shorter. ' +
  'Separate from the app Info banner.';

export const BADGE_BANNER_FILE_ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp';
