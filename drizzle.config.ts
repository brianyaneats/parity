import { defineConfig } from 'drizzle-kit';

/**
 * §4.1: drizzle-kit migrations, checked into git under ./drizzle.
 *
 * `generate` only diffs the schema file against the existing migration
 * history — it never opens a connection — so DATABASE_URL may be a
 * placeholder in CI or on a fresh clone with no database provisioned yet.
 * `migrate`/`studio` do connect and need the real value.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/persistence/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/parity',
  },
});
