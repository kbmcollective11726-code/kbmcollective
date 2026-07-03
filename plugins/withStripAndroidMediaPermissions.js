const { withAndroidManifest, createRunOncePlugin } = require('@expo/config-plugins');

const STRIP = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.RECORD_AUDIO',
];

function ensureRemoveEntries(manifest) {
  const root = manifest.manifest ?? manifest;
  if (!root['uses-permission']) root['uses-permission'] = [];
  const list = Array.isArray(root['uses-permission']) ? root['uses-permission'] : [root['uses-permission']];
  const names = new Set(
    list.map((p) => p?.$?.['android:name']).filter(Boolean),
  );
  for (const perm of STRIP) {
    if (!names.has(perm)) {
      list.push({
        $: {
          'android:name': perm,
          'tools:node': 'remove',
        },
      });
    }
  }
  root['uses-permission'] = list;
  if (!root.$) root.$ = {};
  root.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  return manifest;
}

function withStripAndroidMediaPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = ensureRemoveEntries(cfg.modResults);
    return cfg;
  });
}

module.exports = createRunOncePlugin(
  withStripAndroidMediaPermissions,
  'with-strip-android-media-permissions',
  '1.0.0',
);
