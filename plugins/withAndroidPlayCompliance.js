const {
  withAndroidManifest,
  createRunOncePlugin,
  AndroidConfig,
} = require('@expo/config-plugins');

/**
 * Google Play compliance tweaks applied after Expo's default Android manifest edits:
 * - Drop portrait lock so large screens aren't flagged for orientation/resizability restrictions
 * - Strip SYSTEM_ALERT_WINDOW (dev overlay; not needed in store builds)
 */
function withAndroidPlayCompliance(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const root = manifest.manifest ?? manifest;

    // Ensure tools namespace for permission removals.
    if (!root.$) root.$ = {};
    root.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    // Remove SYSTEM_ALERT_WINDOW from the final merge.
    if (!root['uses-permission']) root['uses-permission'] = [];
    const perms = Array.isArray(root['uses-permission'])
      ? root['uses-permission']
      : [root['uses-permission']];
    const alertName = 'android.permission.SYSTEM_ALERT_WINDOW';
    const hasRemove = perms.some(
      (p) => p?.$?.['android:name'] === alertName && p?.$?.['tools:node'] === 'remove',
    );
    if (!hasRemove) {
      perms.push({
        $: {
          'android:name': alertName,
          'tools:node': 'remove',
        },
      });
    }
    // Also drop any direct grant entry so merge prefers remove.
    root['uses-permission'] = perms.filter((p) => {
      if (p?.$?.['android:name'] !== alertName) return true;
      return p?.$?.['tools:node'] === 'remove';
    });

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    const activities = app.activity ?? [];
    for (const activity of activities) {
      if (!activity?.$) continue;
      // Large-screen Play recommendation: do not force portrait / block resize.
      delete activity.$['android:screenOrientation'];
      if (activity.$['android:resizeableActivity'] === 'false') {
        delete activity.$['android:resizeableActivity'];
      }
    }

    cfg.modResults = manifest;
    return cfg;
  });
}

module.exports = createRunOncePlugin(
  withAndroidPlayCompliance,
  'with-android-play-compliance',
  '1.0.0',
);
