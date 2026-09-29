import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.family.healthtracker',
  appName: 'Health Tracker',
  webDir: 'dist',
  server: {
    // In dev, load from Vite dev server.
    // In production, the bundled dist/ is served locally.
    url: process.env.CAPACITOR_SERVER_URL,
    cleartext: process.env.NODE_ENV !== 'production',
  },
  android: {
    buildOptions: {
      // Android 15 (API 35) — must request SCHEDULE_EXACT_ALARM at runtime.
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  plugins: {
    LocalNotifications: {
      // `smallIcon` must exist in res/drawable, otherwise the plugin falls
      // back to android.R.drawable.ic_dialog_info. `ic_stat_icon_config_sample`
      // is not in this project, so notifications were wearing a generic icon.
      smallIcon: 'ic_launcher_foreground',
      iconColor: '#0f766e',
      // NOTE: no custom `sound`. The plugin resolves `sound` against res/raw
      // and this project has no res/raw, so a name here silently produced a
      // null sound URI and the channel ended up SILENT. Omitting it lets the
      // channel use the system default notification sound, which is what a
      // medication reminder should do.
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0f766e',
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
