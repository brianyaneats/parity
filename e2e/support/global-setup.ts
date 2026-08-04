import { execFileSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

/**
 * Migrates, then builds one fixture account per parallel worker slot.
 *
 * Isolation became necessary the moment bookings started genuinely consuming
 * credit buckets. `claim-lifecycle` books an Edit stay, which correctly burns
 * the `CSR_EDIT_H2` credit — and every later spec that asserts §3.8's
 * published figures then sees a $0 credit face and different, *also correct*,
 * numbers. Run alone each spec passed; run together they contaminated each
 * other. That is shared mutable state, not flakiness, and the fix is
 * isolation rather than making the assertions vaguer.
 *
 * Per-spec `resetDemoData()` calls handle contamination *within* a worker.
 * Seeding every slot up front is what makes the specs that never reset
 * (`theme-no-flash`, `fhr-asymmetry`) safe on any slot they happen to land
 * on: `auth.ts` signs them in as their slot's account, and that account has
 * to exist before the first navigation. `config.workers` is the resolved
 * worker count, so this seeds exactly the slots Playwright will use.
 *
 * Deleting a fixture user cascades to everything it owns (§4.1's `ON DELETE
 * CASCADE` on every user-scoped table), and the seed is idempotent, so
 * re-running it rebuilds a known-good fixture. Global properties (`user_id
 * NULL`) survive and are simply re-upserted.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // No database configured — every spec that needs one skips itself via its
    // own `test.fixme(!process.env.DATABASE_URL, …)` guard, so there is
    // nothing to reset and nothing to fail here.
    return;
  }

  const run = (args: string[], env: Record<string, string> = {}) =>
    execFileSync('npx', args, {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: databaseUrl, ...env },
    });

  run(['tsx', 'src/infrastructure/persistence/migrate.ts']);

  const slots = Math.max(1, config.workers);
  for (let slot = 0; slot < slots; slot += 1) {
    // Same script the per-spec resets run, under the same advisory lock —
    // global setup is just the first resetter, once per slot.
    run(['tsx', 'e2e/support/reset-and-seed.ts'], { TEST_PARALLEL_INDEX: String(slot) });
  }
}

export default globalSetup;
