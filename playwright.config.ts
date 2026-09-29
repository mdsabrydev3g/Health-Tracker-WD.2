import { defineConfig, devices } from '@playwright/test';

/**
 * E2E acceptance tests (§16).
 *
 * These run the REAL app in a browser: IndexedDB, Dexie, the store, the
 * router — no mocks. They cover the behaviours that matter most:
 *   • onboarding creates the person and seeds 9 cardiac medications
 *   • marking a dose taken decrements inventory exactly once
 *   • a double tap does NOT double-decrement (the headline requirement)
 *   • Mother Mode is one giant tap
 *   • the app still works with no network (offline-first)
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The app is Arabic + RTL.
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Serve the production build so we test what actually ships.
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
