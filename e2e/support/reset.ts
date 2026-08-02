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
 * runner never opens its own connection pool alongside the app server's.
 */
export async function resetDemoData(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await run('npx', ['tsx', 'e2e/support/reset-demo-data.ts'], { env: process.env });
  await run('npx', ['tsx', 'src/infrastructure/persistence/seed/run-seed.ts'], {
    env: process.env,
  });
}
