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

/**
 * Per-worker fixture identity — the fix for this suite's one real flake.
 *
 * Every DB-mutating spec used to share the single account above, and
 * `resetDemoData()` is a `DELETE FROM users` that cascades (§4.1). Since
 * Playwright runs `beforeAll` once *per worker*, one spec's reset routinely
 * fired while a sibling spec's test was mid-flow, cascading its booking and
 * claim out from under it — observed as "Claim not found" on
 * `POST /api/claims/:id/evidence`, and unfixable by serializing the resets
 * against each other, because the collision is between a reset and a
 * *running test*, not between two resets.
 *
 * So each worker gets its own account instead. `TEST_PARALLEL_INDEX` is
 * Playwright's parallel-slot index (0..workers-1, reused when a worker
 * restarts), so the set of fixture users stays small and deterministic.
 * Slot 0 keeps the canonical id and email, which is what a plain
 * `pnpm db:seed` and `global-setup.ts` produce — so a single-worker or
 * manual run is byte-for-byte what it always was.
 */
export const WORKER_INDEX = Number(process.env.TEST_PARALLEL_INDEX ?? '0');

export function demoUserIdFor(workerIndex: number): string {
  if (workerIndex === 0) return DEMO_USER_ID;
  // Keeps the uuid shape (and v4 version/variant nibbles) while varying only
  // the node field, so these read as obviously-related fixture accounts.
  return `11111111-1111-4111-8111-${String(workerIndex).padStart(12, '0')}`;
}

export function demoEmailFor(workerIndex: number): string {
  return workerIndex === 0 ? DEMO_EMAIL : `demo+w${workerIndex}@parity.local`;
}

/** This worker's own fixture account. */
export const WORKER_USER_ID = demoUserIdFor(WORKER_INDEX);
export const WORKER_EMAIL = demoEmailFor(WORKER_INDEX);
