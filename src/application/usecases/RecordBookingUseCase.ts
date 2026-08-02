import { randomUUID } from 'node:crypto';
import { Booking } from '@/domain/booking/Booking';
import { Claim, type ClaimKind } from '@/domain/claim/Claim';
import {
  computeChannelChoiceSavingCents,
  selectChannelChoiceBaseline,
} from '@/domain/ledger/ChannelChoiceSaving';
import { type Cents, cents } from '@/domain/shared/cents';
import { addDays } from '@/domain/shared/Clock';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import { resolveBucketForBooking } from '@/domain/credit/CreditBucketResolution';
import { nightsBetween } from '@/domain/parsing/rate-paste-parser';
import { ApiError } from '@/lib/api/errors';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { CreateBookingInput } from '@/lib/validation/bookings';
import type { BookingRecord } from '@/application/ports/BookingRepository';
import type { ClaimRecord } from '@/application/ports/ClaimRepository';
import type { ComparisonRecord, ComparisonRepository } from '@/application/ports/ComparisonRepository';
import type { NewSavingsEventInput } from '@/application/ports/SavingsEventRepository';
import type { UnitOfWork } from '@/application/ports/UnitOfWork';
import { toNewBookingInput } from '../mappers/booking-mapper';
import { toNewClaimInput } from '../mappers/claim-mapper';
import { toCreditBucketAggregate } from '../mappers/credit-bucket-mapper';
import { DEFAULT_CADENCE_DAYS } from './CreateWatchlistUseCase';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface RecordBookingInput extends CreateBookingInput {
  readonly userId: string;
}

export interface RecordBookingOutput {
  readonly booking: BookingRecord;
  readonly claim: ClaimRecord | null;
}

/**
 * `POST /api/bookings` — §5.2 load-bearing behaviour #1.
 *
 * "If the channel is EDIT or CHASE_TRAVEL and the booking is prepaid,
 * auto-create a `claims` row with `deadline_at = booked_at + 24h`, status
 * ELIGIBLE. `Booking.record()` already raises a `booking.recorded` domain
 * event carrying `opensClaim` and `claimKind` — drain `pullDomainEvents()` in
 * the use case and act on it, inside the same transaction. Do not re-derive
 * the eligibility rule in the route."
 *
 * The eligibility check genuinely lives in exactly one place:
 * `Booking.opensPriceMatchClaim` (read inside `Booking.record()`, which this
 * use case calls and then only *reacts to* — it never re-evaluates
 * `PRICE_MATCHABLE_CHANNELS` or `prepaid` itself). The booking row and the
 * conditional claim row are written inside one `UnitOfWork.run()` call so a
 * crash between the two writes cannot leave a prepaid Edit/Chase Travel
 * booking with no claim — the exact failure §1.5's "no price-match claim
 * window is ever missed" success criterion rules out.
 *
 * Two more side effects were previously missing entirely and are fixed here,
 * inside the same transaction for the same reason as the claim above:
 *
 * - **A `watchlist` row (§7.6)**, when — and only when —
 *   `Booking.isReshoppable` says the booking is refundable with a future
 *   cancellation deadline. Before this, `CreateWatchlistUseCase` (the manual
 *   `POST /api/watchlist` path) had no caller anywhere in the booking flow, so
 *   `/watchlist` and the `watchlist-reshop` cron (Part 9) never had a row to
 *   work with.
 * - **A projected `CHANNEL_CHOICE` savings event (§8.6)**, when the booking
 *   traces back to a saved comparison. Before this, `savings_events` had
 *   exactly one producer (`TransitionClaimUseCase`), so a channel that is
 *   never price-matchable — FHR chief among them, per §2.3.2 — produced no
 *   ledger entry at all even on a successful, money-saving booking. See
 *   `channelChoiceEvent` below for the baseline choice, the cash-only
 *   formula, and why it is projected rather than realized.
 *
 * **Bucket consumption (§2.4) — the P0 fix this comment used to say was
 * pending.** A booking never actually burned a statement credit before this:
 * `credit_buckets.consumed_cents` only ever moved through the manual
 * `POST /api/buckets` flow, which has no UI caller, so `/credits` always read
 * every bucket as untouched. This resolves which live bucket (if any) the
 * booking unlocks — `resolveBucketForBooking`, matching `userId` (implicit:
 * `creditBuckets.listByUser` is already scoped), the booking's **booked-at**
 * date falling inside the bucket's window (never the stay date — §7.5), and
 * the channel/nights/prepaid rules already encoded in
 * `CREDIT_BUCKET_DEFINITIONS` — then assigns it via `Booking.assignBucket`
 * (previously dead code: it raised `booking.bucket_assigned` but nothing ever
 * called it) and applies the clawback rule through the `CreditBucket`
 * aggregate's own `consume()`, never re-derived here. No match is a normal
 * outcome (a `DIRECT_FLEX` booking, an under-minimum Edit stay), not an error.
 *
 * `CreditBucket.consume()` raises `credit.consumed`, drained the same way
 * `ConsumeBucketUseCase` drains it, and reacted to with the identical
 * `CREDIT_BURNED` savings-event shape — see that class's doc comment for why
 * a bucket hit must have exactly one event-writing code path regardless of
 * which flow (manual consumption vs. this automatic one) triggered it.
 */
export class RecordBookingUseCase extends CommandUseCase<RecordBookingInput, RecordBookingOutput> {
  public readonly name = 'record_booking';

  constructor(
    deps: UseCaseDependencies,
    private readonly uow: UnitOfWork,
    private readonly comparisons: ComparisonRepository,
  ) {
    super(deps);
  }

  protected async handle(
    input: RecordBookingInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<RecordBookingOutput> {
    // An IDOR guard, not part of §5.2's contract, but cheap and worth having:
    // a booking must not silently attach to another user's comparison.
    // Kept (rather than discarded once ownership is confirmed) because its
    // `result_snapshot` is also the baseline source for the CHANNEL_CHOICE
    // event below — one fetch serves both jobs.
    let ownedComparison: ComparisonRecord | null = null;
    if (input.comparisonId) {
      ownedComparison = await this.comparisons.findById(input.comparisonId, input.userId);
      if (!ownedComparison) throw ApiError.notFound('Comparison');
    }

    // Read once, like `ctx.now`, so the re-shoppability check inside the
    // transaction and the ledger event's `occurredOn` agree on the same day.
    const todayIsoDate = toIsoDate(ctx.now);

    const booking = Booking.record({
      id: randomUUID(),
      userId: input.userId,
      comparisonId: input.comparisonId ?? null,
      channel: input.channel,
      confirmationNumber: input.confirmationNumber ?? null,
      bookedAt: new Date(input.bookedAt),
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      totalCents: cents(input.totalCents),
      baseCents: cents(input.baseCents),
      cashChargedCents: input.cashChargedCents != null ? cents(input.cashChargedCents) : null,
      pointsUsed: input.pointsUsed ?? null,
      prepaid: input.prepaid,
      refundable: input.refundable,
      cancelDeadline: input.cancelDeadline ?? null,
      // §2.4 / task item 1: which bucket this booking unlocks is resolved from
      // live state below, inside the transaction — never trusted from the
      // client. A client-supplied `bucketId` would let the caller pick which
      // $250/$300 credit to charge against, which is exactly the kind of
      // client-authoritative money decision §5.3 forbids for `/api/compare`'s
      // bucket booleans; the same principle applies here. `Booking.assignBucket`
      // (below, inside the transaction) is what actually sets it.
      bucketId: null,
    });

    // Drained once, up front — `pullDomainEvents()` clears the aggregate's
    // buffer, so this is the only chance to read what it raised.
    const events = booking.pullDomainEvents();

    return this.uow.run(async (repos) => {
      // §2.4, task item 1: resolve which live bucket (if any) this booking
      // unlocks, then assign and consume it *before* the booking row is
      // written — `toNewBookingInput` below reads `booking.bucketId`, which
      // `assignBucket` sets on the aggregate, not on the database row directly.
      const liveBuckets = (await repos.creditBuckets.listByUser(input.userId)).map(
        toCreditBucketAggregate,
      );
      const matchedBucket = resolveBucketForBooking(liveBuckets, {
        channel: booking.channel,
        // Booking.record() has already asserted checkOut > checkIn, so this can
        // only be null if the ISO strings are malformed past Zod's own
        // validation. The 1-night floor is the conservative fallback: it can
        // only make a `minNights: 2` bucket (Edit, THC) NOT match, never wrongly
        // grant a credit.
        nights: nightsBetween(booking.checkIn, booking.checkOut) ?? 1,
        prepaid: booking.prepaid,
        bookedAtIsoDate: toIsoDate(booking.bookedAt),
      });

      let creditBurnedEvents: readonly import('@/domain/shared/DomainEvent').DomainEvent[] = [];
      let consumedBucket: typeof matchedBucket = null;

      if (matchedBucket) {
        booking.assignBucket(matchedBucket.id, ctx.now);

        // No refund is known yet at record time — a price-match claim, if any,
        // resolves later (see `TransitionClaimUseCase`) — so the net charge the
        // credit keys off (§2.4) is simply what actually hit the card today.
        const netChargeCents: Cents = booking.netChargeAfterRefund(cents(0));
        const { clawbackCents } = matchedBucket.assess(netChargeCents);
        matchedBucket.consume(netChargeCents, ctx.now, booking.id);

        const bucketEvents = matchedBucket.pullDomainEvents();

        await repos.creditBuckets.setConsumedCents(
          matchedBucket.id,
          input.userId,
          matchedBucket.consumedCents,
        );

        this.deps.metrics.increment('booking.bucket_consumed', { key: matchedBucket.key });
        logger.info('booking consumed a credit bucket', {
          bucketId: matchedBucket.id,
          bucketKey: matchedBucket.key,
          netChargeCents,
          clawbackCents,
          remainingCents: matchedBucket.remainingCents,
        });

        // Deferred deliberately: `savings_events.booking_id` is a foreign key to
        // `bookings`, and the booking row is not inserted until below. Writing
        // the event here fails with a 23503 the moment it runs against a real
        // Postgres — which the in-memory port fakes, having no referential
        // integrity, cannot reproduce. Found by the E2E suite, not the unit
        // suite, and worth remembering: a fake that does not enforce a
        // constraint cannot fail a test that violates it.
        creditBurnedEvents = bucketEvents;
        consumedBucket = matchedBucket;
      }

      const bookingRecord = await repos.bookings.create(toNewBookingInput(booking));

      // Now that the booking row exists, the events that reference it can land.
      if (consumedBucket) {
        // Same drain-and-react shape as `ConsumeBucketUseCase` — see that
        // class's doc comment: a bucket hit must have exactly one
        // event-writing code path, whichever flow triggered it.
        for (const event of creditBurnedEvents) {
          if (event.type !== 'credit.consumed') continue;
          const appliedCents = event.payload.appliedCents as Cents;
          if (appliedCents <= 0) continue; // already exhausted — no phantom saving

          await repos.savingsEvents.create({
            userId: input.userId,
            bookingId: bookingRecord.id,
            kind: 'CREDIT_BURNED',
            amountCents: appliedCents,
            realized: true,
            occurredOn: todayIsoDate,
            note: `Burned ${consumedBucket.label} (${consumedBucket.key}).`,
          });
          this.deps.metrics.increment('credit.burned_recorded', { key: consumedBucket.key });
        }
      }

      let claim: ClaimRecord | null = null;
      for (const event of events) {
        if (event.type !== 'booking.recorded' || event.payload.opensClaim !== true) continue;

        const claimKind = event.payload.claimKind as ClaimKind;

        // Attach the competing rate the comparison was decided against.
        //
        // Without this the claim opens with `competing_rate_id` null, and the
        // claim kit's generated text (§7.4 item 4) has nothing to compare —
        // the user typed the competing rate into the comparator, it is the
        // entire basis of the claim, and it was being dropped on the floor
        // between the two screens. PM8 also requires the claim to name its
        // source, so a claim without one is not filable.
        const competingRate = booking.comparisonId
          ? await repos.competingRates.findByComparisonId(booking.comparisonId)
          : null;

        const opened = Claim.openForBooking({
          id: randomUUID(),
          userId: input.userId,
          bookingId: bookingRecord.id,
          kind: claimKind,
          bookedAt: booking.bookedAt,
          ...(competingRate ? { competingRateId: competingRate.id } : {}),
          ...(competingRate
            ? { claimedGapCents: cents(booking.baseCents - competingRate.baseCents) }
            : {}),
        });
        claim = await repos.claims.create(toNewClaimInput(opened));

        this.deps.metrics.increment('booking.claim_opened', { kind: claimKind });
        logger.info('booking opened a price-match claim', {
          bookingId: bookingRecord.id,
          claimId: claim.id,
          kind: claimKind,
          deadlineAt: claim.deadlineAt.toISOString(),
        });
      }

      // §7.6: only a booking `Booking.isReshoppable` actually calls
      // re-shoppable — refundable, still ACTIVE (true by construction here),
      // with a cancellation deadline still in the future — gets a watchlist
      // row. A non-refundable or deadline-less booking gets no row at all,
      // not an inactive one; there is nothing to re-shop and nothing to ever
      // reactivate.
      if (booking.isReshoppable(todayIsoDate)) {
        await repos.watchlist.create({
          userId: input.userId,
          bookingId: bookingRecord.id,
          cadenceDays: DEFAULT_CADENCE_DAYS,
          nextCheckAt: addDays(ctx.now, DEFAULT_CADENCE_DAYS),
        });
        this.deps.metrics.increment('booking.watchlisted');
        logger.info('booking added to the re-shop watchlist', {
          bookingId: bookingRecord.id,
          nextCheckAt: addDays(ctx.now, DEFAULT_CADENCE_DAYS).toISOString(),
        });
      }

      // §8.6: a projected CHANNEL_CHOICE event, only when there is an actual
      // comparison snapshot to measure the choice against — see
      // `channelChoiceEvent` for the baseline and the cash-only formula.
      if (ownedComparison) {
        const event = this.channelChoiceEvent(ownedComparison, booking, bookingRecord.id, todayIsoDate);
        if (event) {
          await repos.savingsEvents.create(event);
          this.deps.metrics.increment('booking.channel_choice_recorded');
          logger.info('booking recorded a projected channel-choice saving', {
            bookingId: bookingRecord.id,
            amountCents: event.amountCents,
          });
        }
      }

      this.deps.metrics.increment('booking.recorded', { channel: booking.channel });
      return { booking: bookingRecord, claim };
    });
  }

  /**
   * §8.6 / the task brief's own framing: `CHANNEL_CHOICE` is a counterfactual
   * — "you saved X versus booking the naive way" — not banked cash, so it is
   * written **projected**, never realized. It is also computed **cash-only**
   * (sticker total vs. sticker total), for reasons a previous version of
   * this method got wrong in three ways worth naming, because the fix is
   * exactly the corrections:
   *
   * 1. **It used to double-count the statement credit.**
   *    `ChannelResult.effectiveNetCents` already has `creditKeptCents`
   *    subtracted out (engine §3.3 step 14) — the same dollars this method
   *    burns via its own `CREDIT_BURNED` event, above, for the exact amount
   *    actually applied. Reading `effectiveNetCents` here counted that
   *    credit a second time, silently, inside `CHANNEL_CHOICE`.
   * 2. **It used to mark soft dollars realized.** `perksCents` (a breakfast
   *    *valuation*) and `pointsValueCents` (a points *valuation*) are also
   *    inside `effectiveNetCents`. Neither ever appears on a credit-card
   *    statement, so neither can be "realized" under §1.5 #4's audit
   *    criterion — the ledger's cumulative figure has to survive the user
   *    reconciling it against their statement, and a breakfast valuation
   *    never will.
   * 3. **Coverage used to be accidental.** The old version required an OTA
   *    quote and wrote nothing otherwise, so whether a booking produced a
   *    ledger entry depended on which rows the user happened to type.
   *
   * `computeChannelChoiceSavingCents` (in `domain/ledger/ChannelChoiceSaving`,
   * directly unit-tested there) does the actual `baseline.totalCents −
   * winner.totalCents` subtraction and floors at zero. Every component that
   * formula excludes — perks, points, the credit, the refund — is either not
   * statement money or already has its own realized event (`CREDIT_BURNED`
   * above, `PRICE_MATCH` in `TransitionClaimUseCase`) that fires only once,
   * only when it actually lands; see that function's doc comment for the
   * full accounting. That decomposition is what makes the §7.7 by-source
   * breakdown sum honestly instead of quietly double-booking a dollar under
   * two labels.
   *
   * **Baseline: the OTA row when present, else the worst sticker total.**
   * `selectChannelChoiceBaseline` (same module) prefers OTA because every
   * comparison can be measured against it with the same fixed, recognisable
   * meaning — "what this stay would have cost through the default consumer
   * booking path, without this app" — exactly the traceable input §1.5 #4
   * asks for. When the user entered no OTA quote, it falls back to whichever
   * row has the highest `totalCents` rather than writing nothing: a booking
   * that traces to a comparison should reliably produce an event, not one
   * contingent on which channels the user happened to type in. The note on
   * the returned event names which baseline was used — "vs. OTA rate you
   * entered" or "vs. the most expensive rate you entered" — so the number's
   * meaning survives the same audit.
   */
  private channelChoiceEvent(
    comparison: ComparisonRecord,
    booking: Booking,
    bookingId: string,
    occurredOn: string,
  ): NewSavingsEventInput | null {
    const winner = comparison.resultSnapshot.find((row) => row.channel === booking.channel);
    if (!winner) return null;

    const baseline = selectChannelChoiceBaseline(comparison.resultSnapshot);
    if (!baseline) return null;

    const amountCents = computeChannelChoiceSavingCents(baseline.row, winner);
    // Never claim a non-positive "choice" saving — booking the baseline
    // channel itself, or something that nets worse than it in sticker
    // terms, saved nothing.
    if (amountCents <= 0) return null;

    return {
      userId: booking.userId,
      bookingId,
      kind: 'CHANNEL_CHOICE',
      amountCents,
      realized: false,
      occurredOn,
      note: `Booked ${booking.channel} ${baseline.note} (comparison ${comparison.id}).`,
    };
  }

  protected override describeInput(input: RecordBookingInput) {
    // §12: the hotel/rate list is sensitive — log shape, not the figures.
    return { channel: input.channel, prepaid: input.prepaid, hasComparison: input.comparisonId != null };
  }
}
