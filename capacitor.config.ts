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
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#0f766e',
      sound: 'beep.wav',
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0f766e',
      androidScaleType: 'CENTER_CROP',
    },
  },
};

export default config;
