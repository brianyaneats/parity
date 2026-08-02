import { CREDIT_BUCKET_DEFINITIONS } from '@/domain/rules/credit.rules';
import { windowForDefinition } from '@/domain/credit/CreditWindow';
import type { BucketRow } from './types';

/**
 * Computes the six §7.5 buckets straight from `CREDIT_BUCKET_DEFINITIONS`,
 * all at zero consumption.
 *
 * Why this exists instead of a query: at the time this screen was built, only
 * `src/infrastructure/persistence/queries/properties.ts` and `badges.ts`
 * existed — there was no `credit-buckets` query module to read real
 * consumption from, and this task's owned paths (`src/components/credits/**`,
 * `src/features/credits/**`, `src/app/(app)/credits/**`) do not include
 * `src/infrastructure/persistence/`, so one cannot be added here without
 * writing outside scope. Referencing a module that does not exist yet would
 * also fail `tsc --noEmit` immediately (TypeScript resolves dynamic
 * `import()` specifiers at check time), so a `try/catch` around a
 * not-yet-real import was not an option either.
 *
 * §4.4 seeds "the six credit buckets for the current and next window" from
 * these same definitions — this function computes the identical six rows on
 * demand instead, so `/credits` always renders correct math (real window
 * dates, real days-to-expiry, a working `totalUnburnedCents` headline) rather
 * than a blank placeholder. `CreditWallet` labels this state explicitly
 * (`isLive={false}`) rather than presenting computed zeros as fetched fact. A
 * real `listCreditBuckets(userId)` query can replace this call in
 * `src/app/(app)/credits/page.tsx` later without touching `CreditWallet`'s
 * props shape.
 */
export function computeFallbackBuckets(todayIsoDate: string, userId = 'demo-user'): BucketRow[] {
  const year = Number(todayIsoDate.slice(0, 4));

  return CREDIT_BUCKET_DEFINITIONS.map((definition) => {
    // No `user_settings` row is reachable without a database connection, so
    // the CARDMEMBER_YEAR bucket falls back to the calendar year — exactly
    // CreditWindow's own documented behaviour for a missing anniversary — and
    // is flagged `windowAssumed` so the UI can say so rather than presenting
    // a guess as the real date.
    const window = windowForDefinition(definition, { year, anniversary: null });
    return {
      id: `fallback-${definition.key}`,
      userId,
      cardId: null,
      key: definition.key,
      label: definition.label,
      faceCents: definition.faceCents,
      windowStart: window.start,
      windowEnd: window.end,
      consumedCents: 0,
      windowAssumed: definition.windowKind === 'CARDMEMBER_YEAR',
    };
  });
}
