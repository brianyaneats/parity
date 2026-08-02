import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { claims, creditBuckets } from '../schema';
import { addHours } from '@/domain/shared/Clock';
import { BUCKET_CRITICAL_DAYS } from '@/domain/rules/credit.rules';
import { toIsoDate } from '@/domain/credit/CreditWindow';

/**
 * Sidebar badge counts — §7.2.
 *
 * Only two things are allowed to interrupt: a claim inside its last 24 hours,
 * and a credit bucket within 30 days of expiring with money still on it. Those
 * are the two failures that cost real money — §1.5 lists both as success
 * criteria ("no price-match claim window is ever missed", "all four semiannual
 * credit buckets are burned before expiry").
 *
 * `now` is a parameter rather than a `Date.now()` call so the badge count is
 * testable at a boundary instead of only at whatever time the test happens to
 * run.
 */
export interface BadgeCounts {
  readonly claims: number;
  readonly credits: number;
}

export async function countUrgentBadges(
  userId?: string,
  now: Date = new Date(),
): Promise<BadgeCounts> {
  const horizon = addHours(now, 24);
  const today = toIsoDate(now);

  const [claimRows, bucketRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(claims)
      .where(
        and(
          inArray(claims.status, ['ELIGIBLE', 'PREPARING']),
          lte(claims.deadlineAt, horizon),
          gte(claims.deadlineAt, now),
          ...(userId ? [eq(claims.userId, userId)] : []),
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(creditBuckets)
      .where(
        and(
          // Still open, closing within the critical window, and not yet spent.
          gte(creditBuckets.windowEnd, today),
          lte(
            creditBuckets.windowEnd,
            toIsoDate(new Date(now.getTime() + BUCKET_CRITICAL_DAYS * 86_400_000)),
          ),
          sql`${creditBuckets.consumedCents} < ${creditBuckets.faceCents}`,
          ...(userId ? [eq(creditBuckets.userId, userId)] : []),
        ),
      ),
  ]);

  return {
    claims: claimRows[0]?.count ?? 0,
    credits: bucketRows[0]?.count ?? 0,
  };
}
