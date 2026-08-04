import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { DEMO_USER_ID } from './constants';

const run = promisify(execFile);

/**
 * Deletes and re-seeds the demo account as ONE serialized operation.
 *
 * Playwright's `beforeAll` runs once *per worker process*, so a spec that
 * resets in `beforeAll` stampedes: five workers fire five concurrent
 * delete+seed sequences, and the interleavings are all bad — two seeds race
 * into `duplicate key value violates unique constraint "users_pkey"`, or a
 * read lands between one worker's DELETE and its seed and screenshots a
 * half-empty database (this was the visual-regression suite's flake).
 *
 * Two mechanisms fix it:
 *
 * 1. A Postgres advisory lock held across the whole delete+seed, so
 *    concurrent resets serialize instead of interleaving. The lock lives on
 *    this process's own single connection; the spawned seed script's
 *    connections are strangers to it, which is fine — it is other *resetters*
 *    that must queue, and they all take this same lock first.
 * 2. An optional freshness skip (`PARITY_RESET_SKIP_FRESH_MS`): read-only
 *    suites only need the fixture to *exist* in a known-good state, so after
 *    one worker rebuilds it, the other workers' queued resets become no-ops
 *    instead of pointless (and read-racing) rebuilds. Mutating suites do not
 *    set it and always rebuild. Freshness is judged by the seeded DRAFT
 *    comparison's `created_at` — the last row the seed writes, so its
 *    presence means the previous rebuild ran to completion.
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
          select max(created_at) as newest from comparisons where user_id = ${DEMO_USER_ID}
        `;
        const newest = rows[0]?.newest;
        if (newest && Date.now() - new Date(newest).getTime() < skipFreshMs) {
          console.log('[e2e reset] fixture rebuilt moments ago by another worker; skipping.');
          return;
        }
      }

      await sql`delete from users where id = ${DEMO_USER_ID}`;
      // §4.1's ON DELETE CASCADE takes everything user-scoped with the row;
      // global properties (user_id NULL) stay and are re-upserted by the seed.
      await run('npx', ['tsx', 'src/infrastructure/persistence/seed/run-seed.ts'], {
        env: process.env,
      });
      console.log('[e2e reset] demo account rebuilt.');
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
