import { defineConfig } from '@playwright/test';
import { BASE_URL, PORT } from './e2e/support/constants';

/**
 * Playwright config for Parity's E2E suite — §10.1, §10.3, §10.4.
 *
 * Three projects, not one:
 *
 * - `desktop` — 1440px, light. Runs the six §10.3 flows (mobile-compare
 *   excluded — it needs the 390px viewport §6.7 makes a first-class
 *   breakpoint), the theme-flash test, and — shared with `dark` below — the
 *   axe and visual-regression suites.
 * - `mobile` — 390px. "The comparator must be fully usable at 390px" (§6.7);
 *   flow 6 runs here and nowhere else.
 * - `dark` — same 1440px viewport as `desktop` but `colorScheme: 'dark'`.
 *   Exists specifically so the axe pass and visual-regression baselines run
 *   "in both themes" (§10.1) without forking either spec file: the same test
 *   runs twice, once per project, and only the OS-level colour-scheme signal
 *   differs. (`theme-no-flash.spec.ts` sets its own forced colour scheme via
 *   `test.use`, since that test's whole point is a *mismatch* between the
 *   forced OS scheme and the theme cookie, so it does not need this project.)
 *
 * Auth: every test signs in as the seeded demo account via a real session
 * cookie — see `e2e/support/test.ts` and `e2e/support/auth.ts`. Requires a
 * migrated, seeded database at `DATABASE_URL` (below) before the run:
 * `pnpm db:migrate && pnpm db:seed`.
 *
 * The server this suite runs against is a **production build**
 * (`pnpm build && pnpm start`), not `pnpm dev` — this was a real, measured
 * bug, not a preference: under `fullyParallel: true` with multiple workers,
 * `next dev` compiles each route lazily on its first request, several
 * workers requested different uncompiled routes at once, the dev server
 * serialised those compilations, and the slower ones exceeded
 * `navigationTimeout` — surfacing as `net::ERR_EMPTY_RESPONSE` or a timeout
 * that looked exactly like a real axe violation or a broken selector, on
 * `accessibility.spec.ts` and `theme-no-flash.spec.ts` in particular.
 * `--workers=1` made the symptom disappear, which confirmed compile
 * contention rather than a real failure. A production server has every route
 * already compiled before the first request, which removes the race
 * entirely, and is additionally the more representative target for §0.4's
 * Lighthouse budget and for visual-regression baselines (dev mode injects
 * extra markup — React DevTools hooks, HMR client — that a production build
 * does not ship). The one-time build cost is paid once per run;
 * `reuseExistingServer: !process.env.CI` still avoids paying it again for a
 * developer who already has this exact server running locally.
 *
 * Port: pinned to 4310, not Next's default 3000. This is not cosmetic — on
 * at least one dev machine this suite ran on, port 3000 was already held by
 * an unrelated stray Node process from a *different* project, and with
 * `reuseExistingServer: true` Playwright silently ran every test against
 * that wrong server instead of this app (symptom: every selector timed out,
 * as if the page were blank — because it was a different app entirely). A
 * dedicated port makes that class of failure structurally impossible instead
 * of relying on remembering to check `lsof -i :3000` first.
 */
export default defineConfig({
  testDir: './e2e',
  // Rebuilds the demo account before the suite. Bookings now genuinely
  // consume credit buckets, so one spec's booking would otherwise change
  // the figures a later spec asserts — shared mutable state, not flakiness.
  globalSetup: './e2e/support/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
      testMatch: [
        '**/compare-and-decide.spec.ts',
        '**/claim-lifecycle.spec.ts',
        '**/deadline-expiry.spec.ts',
        '**/clawback-guard.spec.ts',
        '**/fhr-asymmetry.spec.ts',
        '**/theme-no-flash.spec.ts',
        '**/accessibility.spec.ts',
        '**/visual-regression.spec.ts',
      ],
    },
    {
      name: 'mobile',
      // §6.7: 390px is a first-class breakpoint, not an afterthought. A plain
      // Chromium viewport (rather than a specific device profile) is
      // deliberate — flow 6 is about layout at a width, not about touch input
      // or a specific device's UA string.
      use: { viewport: { width: 390, height: 844 }, colorScheme: 'light' },
      testMatch: ['**/mobile-compare.spec.ts'],
    },
    {
      name: 'dark',
      use: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
      testMatch: ['**/accessibility.spec.ts', '**/visual-regression.spec.ts'],
    },
  ],

  webServer: {
    command: 'pnpm build && pnpm start',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      NEXT_TELEMETRY_DISABLED: '1',
      // A migrated, seeded Postgres must already be reachable here — see the
      // file header. Defaults to the same local instance README.md's setup
      // steps produce; override for CI (a Postgres service container) or a
      // hosted branch by setting `DATABASE_URL` before invoking Playwright.
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://parity:parity@localhost:5432/parity',
    },
  },
});
