/**
 * The database connection — §4.1.
 *
 * A single `postgres` client and `drizzle()` instance per server process,
 * reading `DATABASE_URL`. Next.js dev hot-reload re-evaluates this module on
 * every save; without caching the client on `globalThis`, each reload would
 * open a fresh TCP connection and, within a few edits, exhaust a managed
 * Postgres provider's (e.g. Neon's) connection limit. This is the standard
 * workaround for that specific Next.js dev behavior, not a production concern
 * — a production process only imports this module once.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres instance.',
    );
  }
  return url;
}

declare global {
  // eslint-disable-next-line no-var -- `var` is required for global augmentation.
  var __parityDbClient: postgres.Sql | undefined;
}

const client = globalThis.__parityDbClient ?? postgres(requireDatabaseUrl());
globalThis.__parityDbClient = client;

export const db = drizzle(client, { schema });

export type Database = typeof db;

/**
 * `GET /api/health` — §5.2, the one unauthenticated route. Confirms not just
 * that the process is up but that the database is actually reachable, and
 * reports round-trip latency so a slow-but-alive database is distinguishable
 * from a dead one.
 *
 * Resolves to the latency in milliseconds on success and rejects on failure
 * — `src/app/api/health/route.ts` (pre-existing, not part of this
 * deliverable) already imports this function and relies on exactly that
 * contract: it awaits `checkDatabase()` directly as the latency number and
 * catches a thrown error to report `degraded`/503, so the signature here
 * follows that existing caller rather than the more defensive
 * discriminated-union shape this file would otherwise use on a clean slate.
 */
export async function checkDatabase(): Promise<number> {
  const start = performance.now();
  await client`SELECT 1`;
  return Math.round(performance.now() - start);
}
