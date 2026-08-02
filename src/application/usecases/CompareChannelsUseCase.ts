import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import type { ComparisonResult } from '@/domain/engine/types';
import type { CompareRequest } from '@/lib/validation/compare';
import { UseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';
import type { Logger } from '@/infrastructure/observability/Logger';
import { toStayContext, toChannelQuotes } from '../mappers/compare-mapper';
import { toIsoDate } from '@/domain/credit/CreditWindow';
import {
  deriveBucketAvailability,
  type BucketAvailabilitySnapshot,
} from '@/domain/credit/CreditBucketResolution';
import { toCreditBucketAggregate } from '../mappers/credit-bucket-mapper';
import type { CreditBucketRepository } from '../ports/CreditBucketRepository';

export interface CompareChannelsInput extends CompareRequest {}

export interface CompareChannelsOutput extends ComparisonResult {
  /**
   * §5.3 / task item 3: "the response must tell the UI what the real state
   * was so it can show it." This is what lets `CompareScreen` stop lying about
   * `amexBucketAvailable`/`editBucketAvailable` — the P0 defect's other half.
   */
  readonly bucketAvailability: BucketAvailabilitySnapshot;
}

/**
 * `POST /api/compare` — §5.2, §5.3.
 *
 * Stateless. Persists nothing (beyond the one read below). Called on every
 * keystroke behind a 250 ms debounce, so it carries the §5.3 p95 budget of
 * 100 ms as an enforced value rather than a comment (DECISIONS.md D-043).
 *
 * The important architectural point: this use case *wraps* the engine, it does
 * not reimplement any part of it. §5.3 is explicit — "Do not fork the math into
 * two implementations; import one module in both places." The client computes
 * optimistically from the same `SavingsEngine` for instant feedback, and
 * reconciles to this response, which is authoritative.
 *
 * The engine itself stays pure (§3): the timing and logging happen out here,
 * around the call, never inside it. See DECISIONS.md D-041.
 *
 * **§5.3 / task item 3 — the P0 fix.** `amexBucketAvailable` /
 * `editBucketAvailable` used to come straight from the request body, which
 * means whatever `CompareScreen`'s toggles happened to say (previously always
 * `true` — see `CompareScreen`'s own fix) silently decided the ranking. The
 * request fields are *kept* (the client still computes optimistically from
 * the same engine, and may pass an explicit override for a "what if"
 * preview), but they are never forwarded to the engine unmodified: this reads
 * the caller's live bucket state and substitutes the real booleans before
 * calling `compare()`, then returns the derived snapshot alongside the result
 * so the UI can reconcile to it instead of to its own guess.
 */
export class CompareChannelsUseCase extends UseCase<CompareChannelsInput, CompareChannelsOutput> {
  public readonly name = 'compare_channels';

  /** §5.3: "must be pure and fast (p95 < 100 ms)". */
  protected override readonly budgetMs = 100;

  private readonly engine: SavingsEngine;

  constructor(
    deps: UseCaseDependencies,
    engine: SavingsEngine,
    private readonly creditBuckets: CreditBucketRepository,
  ) {
    super(deps);
    this.engine = engine;
  }

  protected async handle(
    input: CompareChannelsInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<CompareChannelsOutput> {
    // Live state, scoped to the caller, always wins — never the client's
    // optimistic guess. §7.5's window rule applies here too: a comparison
    // computed "now" is a hypothetical booking made "now", so today's date is
    // the right anchor for window membership, same as a real booking's
    // booked-at date.
    const liveBuckets = (await this.creditBuckets.listByUser(ctx.userId)).map(toCreditBucketAggregate);
    const bucketAvailability = deriveBucketAvailability(liveBuckets, toIsoDate(ctx.now));

    const context = {
      ...toStayContext(input.context),
      amexBucketAvailable: bucketAvailability.amexBucketAvailable,
      editBucketAvailable: bucketAvailability.editBucketAvailable,
    };

    const outcome = this.engine.compare({
      context,
      quotes: toChannelQuotes(input.quotes),
      ...(input.brgOptions ? { brgOptions: input.brgOptions } : {}),
    });

    // Business-level counters, not just latency. These answer the questions the
    // spec's success criteria in §1.5 actually ask — which channel keeps
    // winning, and how often a price-match opportunity is on the table.
    const winner = outcome.winner;
    if (winner) {
      this.deps.metrics.increment('compare.winner', { channel: winner.channel });
      if (winner.priceMatch.qualifies) {
        this.deps.metrics.increment('compare.price_match_available');
      }
      if (winner.clawbackCents > 0) {
        this.deps.metrics.increment('compare.clawback_risk');
      }
    }
    for (const warning of outcome.warnings) {
      this.deps.metrics.increment('compare.warning', { warning });
    }

    logger.debug('comparison computed', {
      quoteCount: input.quotes.length,
      winner: winner?.channel ?? null,
      warnings: outcome.warnings,
      engineVersion: outcome.engineVersion,
      amexBucketAvailable: bucketAvailability.amexBucketAvailable,
      editBucketAvailable: bucketAvailability.editBucketAvailable,
    });

    return { ...outcome, bucketAvailability };
  }

  /**
   * §12 treats the user's hotel list as sensitive, so the log records the
   * *shape* of the request — how many channels, which ones, whether a competing
   * rate was entered — and never the rates themselves.
   */
  protected override describeInput(input: CompareChannelsInput) {
    return {
      quoteCount: input.quotes.length,
      channels: input.quotes.map((quote) => quote.channel),
      nights: input.context.nights,
      hasCompetitor: input.context.competitorBaseCents !== null,
      brand: input.context.brand,
    };
  }
}
