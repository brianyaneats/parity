/**
 * Shared constants for the E2E suite.
 *
 * Port: pinned to 4310, not Next's default 3000 — see `playwright.config.ts`
 * for why (a stray unrelated process on 3000 silently ran every test against
 * the wrong app on at least one dev machine this suite ran on).
 */
export const PORT = 4310;
export const BASE_URL = `http://localhost:${PORT}`;

/**
 * Auth: the demo account `pnpm db:seed` creates — see
 * `src/infrastructure/persistence/seed/run-seed.ts`, which prints this exact
 * id and hardcodes it as `DEMO_USER_ID`. `e2e/support/auth.ts` signs every
 * test in as this account by setting the real `parity-session` cookie
 * (`src/lib/auth/session.ts`'s primary, production-safe auth path), not the
 * `PARITY_DEMO_USER` dev-only environment escape hatch that same file also
 * documents — that escape hatch is explicitly refused whenever
 * `NODE_ENV === 'production'`, and `playwright.config.ts` runs this suite
 * against a production build (`pnpm build && pnpm start`) specifically to
 * avoid dev-server compile-on-first-request flakiness under parallel
 * workers, so it is not available to this suite at all.
 *
 * Requires a migrated, seeded Postgres reachable at `DATABASE_URL` before the
 * suite runs — `pnpm db:migrate && pnpm db:seed`, matching README.md's local
 * setup (`.github/workflows/ci.yml` does the equivalent with a Postgres
 * service container).
 */
export const DEMO_USER_ID = '11111111-1111-4111-8111-111111111111';
export const DEMO_EMAIL = 'demo@parity.local';
