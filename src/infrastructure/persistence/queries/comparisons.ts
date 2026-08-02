import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { comparisons } from '../schema';
import type { ChannelResult, StayContext } from '@/domain/engine/types';

/**
 * Read models for saved comparisons.
 *
 * These return the **stored snapshot** verbatim. §4.3: "`context_snapshot` and
 * `result_snapshot` are immutable records of what the engine said at the time."
 * There is deliberately no function in this module that recomputes anything —
 * recomputation goes through `POST /api/comparisons/:id/recompute` and creates
 * a new row.
 */

export interface SavedComparisonView {
  readonly id: string;
  readonly propertyName: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly createdAt: string;
  readonly engineVersion: string;
  readonly context: StayContext;
  readonly results: readonly ChannelResult[];
  readonly chosenChannel: string | null;
  readonly recomputedFromId: string | null;
}

export async function findComparisonById(
  id: string,
  userId?: string,
): Promise<SavedComparisonView | null> {
  const rows = await db
    .select()
    .from(comparisons)
    .where(userId ? and(eq(comparisons.id, id), eq(comparisons.userId, userId)) : eq(comparisons.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    propertyName: row.propertyNameSnapshot,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    nights: row.nights,
    createdAt: row.createdAt.toISOString(),
    engineVersion: row.engineVersion,
    context: row.contextSnapshot,
    results: row.resultSnapshot,
    chosenChannel: row.chosenChannel,
    recomputedFromId: null,
  };
}

export async function listComparisons(
  userId: string,
  limit = 50,
): Promise<readonly SavedComparisonView[]> {
  const rows = await db
    .select()
    .from(comparisons)
    .where(eq(comparisons.userId, userId))
    .orderBy(desc(comparisons.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    propertyName: row.propertyNameSnapshot,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    nights: row.nights,
    createdAt: row.createdAt.toISOString(),
    engineVersion: row.engineVersion,
    context: row.contextSnapshot,
    results: row.resultSnapshot,
    chosenChannel: row.chosenChannel,
    recomputedFromId: null,
  }));
}
