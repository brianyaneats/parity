import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { WORKER_EMAIL, WORKER_USER_ID } from './constants';

const run = promisify(execFile);

/**
 * Deletes and re-seeds THIS worker's fixture account as one serialized
 * operation.
 *
 * Two mechanisms, fixing two different collisions:
 *
 * 1. **Per-worker accounts** (`constants.ts`) mean a reset only ever deletes
 *    rows the calling worker owns. This is what stops the real flake: the
 *    delete cascades (§4.1), and with a shared account it routinely ran while
 *    a *sibling spec's test* was mid-flow, taking that test's booking and
 *    claim with it ("Claim not found" on the evidence POST). No lock can fix
 *    that one — the collision is between a reset and a running test, not
 *    between two resets — only not sharing the data can.
 * 2. **A Postgres advisory lock** across the delete+seed, because the seed
 *    also upserts the ~45 *global* properties (`user_id NULL`) that every
 *    worker shares; concurrent seeds would race there. The lock lives on this
 *    process's own connection, and every resetter takes it first, so they
 *    queue instead of interleaving.
 *
 * `PARITY_RESET_SKIP_FRESH_MS` additionally lets read-only suites (visual
 * regression, axe) skip a rebuild that another worker just did — they need
 * the fixture to exist in its seeded state, not to be rebuilt per worker.
 * Freshness is judged by the seeded DRAFT comparison's `created_at`, the last
 * row the seed writes, so its presence means the rebuild ran to completion.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`select pg_advisory_lock(hashtext('parity-e2e-demo-reset'))`;
    try {
      const skipFreshMs = Number(process.env.PARITY_RESET_SKIP_FRESH_MS ?? '0');
      if (skipFreshMs > 0) {
        const rows = await sql<{ newest: Date | null }[]>`
          select max(created_at) as newest from comparisons where user_id = ${WORKER_USER_ID}
        `;
        const newest = rows[0]?.newest;
        if (newest && Date.now() - new Date(newest).getTime() < skipFreshMs) {
          console.log('[e2e reset] fixture rebuilt moments ago; skipping.');
          return;
        }
      }

      await sql`delete from users where id = ${WORKER_USER_ID}`;
      // §4.1's ON DELETE CASCADE takes everything user-scoped with the row;
      // global properties (user_id NULL) stay and are re-upserted by the seed.
      await run('npx', ['tsx', 'src/infrastructure/persistence/seed/run-seed.ts'], {
        env: {
          ...process.env,
          PARITY_SEED_USER_ID: WORKER_USER_ID,
          PARITY_SEED_EMAIL: WORKER_EMAIL,
        },
      });
      console.log(`[e2e reset] rebuilt ${WORKER_EMAIL}.`);
    } finally {
      await sql`select pg_advisory_unlock(hashtext('parity-e2e-demo-reset'))`;
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('[e2e reset] failed', error);
  process.exit(1);
});
