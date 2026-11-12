const { getSentryExpoConfig } = require('@sentry/react-native/metro');

/** Sentry Metro config (wraps Expo defaults) for source maps / Debug IDs. */
const config = getSentryExpoConfig(__dirname);

// Windows/OneDrive: don't watch ephemeral Gradle/.cxx trees under expo-modules-core.
// Watching them causes ENOENT crashes and leaves Expo Go stuck on the spinner.
// Use plain RegExp blockList (avoid metro-config exclusionList ESM path bug on Windows).
config.resolver = config.resolver || {};
config.resolver.blockList = [
  /node_modules[\\/]expo-modules-core[\\/]android[\\/]\.cxx([\\/].*)?$/,
  /node_modules[\\/]expo-modules-core[\\/]expo-module-gradle-plugin[\\/]build([\\/].*)?$/,
];

module.exports = config;
