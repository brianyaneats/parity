import { execFileSync } from 'node:child_process';

/**
 * Resets the database before the suite.
 *
 * This became necessary the moment bookings started genuinely consuming credit
 * buckets. `claim-lifecycle` books an Edit stay, which correctly burns the
 * `CSR_EDIT_H2` credit — and every later spec that asserts §3.8's published
 * figures then sees a $0 credit face and different, *also correct*, numbers.
 * Run alone each spec passed; run together they contaminated each other.
 *
 * That is shared mutable state, not flakiness, and the fix is isolation rather
 * than making the assertions vaguer. CI already gets this for free by spinning
 * a fresh Postgres service container per job; this gives a local run the same
 * guarantee.
 *
 * Deleting the demo user cascades to everything it owns (§4.1's `ON DELETE
 * CASCADE` on every user-scoped table), and the seed is idempotent, so
 * re-running it rebuilds a known-good fixture. Global properties (`user_id
 * NULL`) survive and are simply re-upserted.
 */
async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // No database configured — every spec that needs one skips itself via its
    // own `test.fixme(!process.env.DATABASE_URL, …)` guard, so there is
    // nothing to reset and nothing to fail here.
    return;
  }

  const run = (args: string[]) =>
    execFileSync('npx', args, {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });

  run(['tsx', 'src/infrastructure/persistence/migrate.ts']);
  run(['tsx', 'e2e/support/reset-demo-data.ts']);
  run(['tsx', 'src/infrastructure/persistence/seed/run-seed.ts']);
}

export default globalSetup;
