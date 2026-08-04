/**
 * Applies pending migrations from `./drizzle` — backs the `db:migrate` script.
 *
 * Uses its own single, unpooled connection rather than the app's cached
 * client in `db.ts`: migrations run DDL once at deploy time, not per-request,
 * and should not share a long-lived pooled client with the app. Logs how many
 * migrations were applied and exits non-zero on failure so CI/CD treats a
 * failed migration as a failed deploy rather than a silent no-op.
 */
import './load-env';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = './drizzle';

/**
 * drizzle-orm's migrator tracks applied migrations in this table (schema
 * `drizzle`, table `__drizzle_migrations` — its own fixed default, not one
 * this project chose). Counting rows before and after is how this script
 * reports how many migrations actually ran, since `migrate()` itself returns
 * `void`.
 */
async function countAppliedMigrations(sql: postgres.Sql): Promise<number> {
  try {
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count from drizzle.__drizzle_migrations
    `;
    return rows[0]?.count ?? 0;
  } catch {
    // Table doesn't exist yet on a brand-new database — nothing applied so far.
    return 0;
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    const before = await countAppliedMigrations(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const after = await countAppliedMigrations(client);
    console.log(`[migrate] applied ${after - before} migration(s); ${after} total.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] failed:', error);
  process.exit(1);
});
