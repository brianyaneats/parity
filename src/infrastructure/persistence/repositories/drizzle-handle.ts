import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../schema';

/**
 * The transaction handle `db.transaction(async (tx) => …)` hands to its
 * callback, named directly against `drizzle-orm`'s own exported types rather
 * than inferred structurally from `typeof db.transaction`. An `infer`-based
 * extraction over a generic method's type looks appealing (one fewer import)
 * but does not reliably resolve here — `db.transaction`'s own type parameter
 * defeats a naked conditional match — so this names the concrete
 * instantiation instead, which is exactly what `PostgresJsDatabase`'s own
 * `transaction()` signature resolves to for *this* app's schema.
 */
export type DrizzleTx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/** Either the pooled client or an open transaction — repositories accept both. */
export type DrizzleHandle = typeof db | DrizzleTx;
