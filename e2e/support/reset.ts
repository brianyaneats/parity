import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Rebuilds the demo account to a known-good fixture.
 *
 * Needed because bookings genuinely consume credit buckets now: a spec that
 * books an Edit stay correctly burns `CSR_EDIT_H2`, and any spec asserting
 * §3.8's published figures afterwards sees a $0 credit face and different —
 * also correct — numbers. Each spec that depends on those figures resets first
 * rather than depending on file order, which is not a contract Playwright
 * offers.
 *
 * Runs as a child process rather than importing `db` directly so the test
 * runner never opens its own connection pool alongside the app server's. The
 * child (`reset-and-seed.ts`) holds a Postgres advisory lock across the whole
 * delete+seed, so per-worker `beforeAll` stampedes serialize instead of
 * corrupting each other — see its header for the full story.
 *
 * `skipIfFresherThanMs` is for read-only suites (visual regression, axe):
 * they only need the fixture to exist in its seeded state, so once one worker
 * has rebuilt it, sibling workers' resets become no-ops rather than rebuilds
 * that race someone else's screenshot.
 */
export async function resetDemoData(options?: {
  readonly skipIfFresherThanMs?: number;
}): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await run('npx', ['tsx', 'e2e/support/reset-and-seed.ts'], {
    env: {
      ...process.env,
      PARITY_RESET_SKIP_FRESH_MS: String(options?.skipIfFresherThanMs ?? 0),
    },
  });
}
