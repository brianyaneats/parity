import type { Cents } from '../shared/cents';
import { ZERO_CENTS } from '../shared/cents';
import { CREDIT_BUCKET_DEFINITIONS, type CreditBucketDefinition } from '../rules/credit.rules';
import type { Channel } from '../rules/channels.rules';
import { windowContains } from './CreditWindow';
import type { CreditBucket } from './CreditBucket';

/**
 * P0 fix — see `RecordBookingUseCase` and `CompareChannelsUseCase`.
 *
 * Two related, pure resolvers over an already-loaded set of live `CreditBucket`
 * aggregates. Neither does I/O; the use case fetches the rows, rehydrates them
 * with `toCreditBucketAggregate` (`application/mappers/credit-bucket-mapper`),
 * and hands the aggregates in here. Keeping this in `src/domain/` (rather than
 * next to the use cases) keeps the matching rules testable without a database
 * and keeps the dependency direction the same as the rest of the domain layer:
 * this file may know about `CreditBucketRepository`'s record shape via nothing
 * more than structural typing on `CreditBucket` itself.
 */

export interface BookingBucketMatch {
  readonly channel: Channel;
  readonly nights: number;
  readonly prepaid: boolean;
  /**
   * ISO `YYYY-MM-DD`. The date the booking was **made**, never the stay date —
   * §7.5: "a booking prepaid now for a stay next year still burns this
   * window's credit."
   */
  readonly bookedAtIsoDate: string;
}

/**
 * Resolves which single live bucket (if any) a real booking unlocks — §2.4.
 *
 * Matches `CREDIT_BUCKET_DEFINITIONS` against `(channel, nights, prepaid)`,
 * then requires a live bucket with that `key` whose window contains the
 * booking's **booked-at** date. Returns `null` when nothing matches, which is
 * a normal outcome (a DIRECT_FLEX booking, an under-minimum Edit stay, an
 * exhausted window) — never an error.
 *
 * More than one definition can structurally match the same booking: an Edit
 * stay also satisfies `CSR_TRAVEL`'s rules, because that bucket's
 * `unlockChannels` deliberately covers almost every paid channel (it models
 * Chase's broad, card-wide travel credit, not a programme-specific one).
 * `CREDIT_BUCKET_DEFINITIONS`' own declared order — the specific,
 * programme-tied credit listed before the broad one — doubles as the
 * tie-break, so a two-night Edit stay draws down the $250 Edit credit before
 * it ever touches the $300 general travel credit. SPEC-GAP (§0.3 item 3): the
 * spec does not state this ordering explicitly. This is the conservative
 * reading — it prefers the specific, exhaustible credit over the broad one
 * that would otherwise be silently drained by every booking regardless of
 * channel, which would make the broad credit's own remaining balance
 * unpredictable for the user.
 */
export function resolveBucketForBooking(
  liveBuckets: readonly CreditBucket[],
  input: BookingBucketMatch,
): CreditBucket | null {
  for (const definition of CREDIT_BUCKET_DEFINITIONS) {
    if (!definitionMatches(definition, input)) continue;

    const bucket = liveBuckets.find(
      (candidate) =>
        candidate.key === definition.key && windowContains(candidate.window, input.bookedAtIsoDate),
    );
    if (bucket) return bucket;
  }
  return null;
}

function definitionMatches(
  definition: CreditBucketDefinition,
  input: Pick<BookingBucketMatch, 'channel' | 'nights' | 'prepaid'>,
): boolean {
  return (
    definition.unlockChannels.includes(input.channel) &&
    input.nights >= definition.minNights &&
    (!definition.requiresPrepaid || input.prepaid)
  );
}

/**
 * Live availability of the two buckets the pure engine actually models.
 *
 * `src/domain/engine/credit-face.ts`'s `creditFaceFor` reads only
 * `amexBucketAvailable` (FHR/THC) and `editBucketAvailable` (EDIT), and its own
 * comment documents that the select-brands and broad travel buckets are
 * deliberately outside the pure engine's model — those are resolved generically
 * by `resolveBucketForBooking` above, at real-booking time, instead. This is
 * the other half of that same boundary: it derives exactly the two booleans
 * the engine consumes, from real state, for `POST /api/compare` (§5.3 — "the
 * server response is authoritative").
 */
export interface BucketAvailabilitySnapshot {
  readonly amexBucketAvailable: boolean;
  readonly amexRemainingCents: Cents;
  readonly editBucketAvailable: boolean;
  readonly editRemainingCents: Cents;
}

const AMEX_HOTEL_KEYS: ReadonlySet<string> = new Set(['AMEX_HOTEL_H1', 'AMEX_HOTEL_H2']);
const CSR_EDIT_KEYS: ReadonlySet<string> = new Set(['CSR_EDIT_H1', 'CSR_EDIT_H2']);

export function deriveBucketAvailability(
  liveBuckets: readonly CreditBucket[],
  todayIsoDate: string,
): BucketAvailabilitySnapshot {
  const amex = liveBuckets.find(
    (bucket) => AMEX_HOTEL_KEYS.has(bucket.key) && windowContains(bucket.window, todayIsoDate),
  );
  const edit = liveBuckets.find(
    (bucket) => CSR_EDIT_KEYS.has(bucket.key) && windowContains(bucket.window, todayIsoDate),
  );

  const amexRemainingCents = amex?.remainingCents ?? ZERO_CENTS;
  const editRemainingCents = edit?.remainingCents ?? ZERO_CENTS;

  return {
    amexBucketAvailable: amexRemainingCents > 0,
    amexRemainingCents,
    editBucketAvailable: editRemainingCents > 0,
    editRemainingCents,
  };
}
