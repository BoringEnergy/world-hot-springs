/**
 * The browser harness. `npm run test:e2e`; see e2e/README.md.
 *
 * It drives a production build made in the `e2e` mode, which is the build
 * Vercel ships plus MapView's instrumentation (`window.__map`, the
 * `data-map-*` attributes). Nothing leaves the machine: e2e/support/offline.ts
 * answers every third-party request from fixtures and fails a test that
 * reaches for a host it does not know.
 */
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  // Explicit, and load-bearing: the default is the config's own directory,
  // which would sweep up scripts/**/*.test.mjs -- node:test files that
  // Playwright cannot run.
  testDir: 'e2e',
  // A retry turns a flaky test into a green one, and the flake rate is the
  // number this harness has not measured yet. Until it has, a flake is a red.
  retries: 0,
  forbidOnly: CI,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ...(CI ? ([['github']] as const) : []),
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'en-GB',
    timezoneId: 'UTC',
    // The camera flights are animations; a spec that needs one says so.
    reducedMotion: 'reduce',
    // A service worker would answer requests the offline fixture never sees.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Belt and braces under e2e/support/offline.ts: if a request ever
          // slips past the route, it fails DNS instead of reaching the
          // internet. Routed requests are fulfilled before any lookup, so
          // this changes nothing for them -- measured, see e2e/README.md.
          args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build:e2e && npm run preview:e2e',
    url: 'http://127.0.0.1:4173',
    // Pinned here and nowhere else. A leaked NODE_ENV=development makes Vite
    // build a development bundle; set at CI job level instead, it would make
    // `npm ci` skip every devDependency, Vite and Playwright included.
    env: { NODE_ENV: 'production' },
    timeout: 180_000,
    // Never test whatever happens to be listening on the port: it may be a
    // plain `dist/` preview with no instrumentation, or yesterday's build.
    reuseExistingServer: false,
  },
});
