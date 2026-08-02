import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import type { ChannelQuote } from '@/domain/engine/types';
import { ApiError } from '@/lib/api/errors';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { ComparisonRecord, ComparisonRepository } from '@/application/ports/ComparisonRepository';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface RecomputeComparisonInput {
  readonly id: string;
  readonly userId: string;
}

/**
 * `POST /api/comparisons/:id/recompute` — §5.2 load-bearing behaviour #3, §4.3.
 *
 * "Creates a **new** comparison row from current rules and NEVER mutates the
 * original." §13.3 predicts this is where an agent gets it wrong, and the
 * mitigation is structural, not procedural: this class calls
 * `this.comparisons.create(...)` and nothing else — it never calls
 * `.update()` on the original, and `ComparisonRepository.update()`'s own
 * `ComparisonPatch` type could not carry a snapshot even if it tried (see
 * `ComparisonRepository.ts`). The original row is read once, at the top, and
 * is never touched again.
 *
 * "From current rules" means: same `contextSnapshot` (the stay's own facts —
 * nights, tax rate, brand, breakfast value, … — do not change on recompute),
 * same quotes, but run through *today's* engine build. If a rule constant
 * changed since the original was saved, the new row's numbers move and its
 * `engineVersion` differs from the original's — which is exactly the signal
 * §4.3's UI note ("computed under engine v1.0.2") is for.
 */
export class RecomputeComparisonUseCase extends CommandUseCase<RecomputeComparisonInput, ComparisonRecord> {
  public readonly name = 'recompute_comparison';

  private readonly engine: SavingsEngine;

  constructor(
    deps: UseCaseDependencies,
    private readonly comparisons: ComparisonRepository,
    engine: SavingsEngine = new SavingsEngine(),
  ) {
    super(deps);
    this.engine = engine;
  }

  protected async handle(
    input: RecomputeComparisonInput,
    _ctx: ExecutionContext,
    logger: Logger,
  ): Promise<ComparisonRecord> {
    const original = await this.comparisons.findById(input.id, input.userId);
    if (!original) throw ApiError.notFound('Comparison');

    const quotes: ChannelQuote[] = original.quotes.map((quote) => ({
      channel: quote.channel,
      totalCents: quote.totalCents,
      prepaid: quote.prepaid,
      refundable: quote.refundable,
      ...(quote.label ? { label: quote.label } : {}),
    }));

    const outcome = this.engine.compare({ context: original.contextSnapshot, quotes });

    const created = await this.comparisons.create({
      userId: input.userId,
      tripId: original.tripId,
      propertyId: original.propertyId,
      propertyNameSnapshot: original.propertyNameSnapshot,
      checkIn: original.checkIn,
      checkOut: original.checkOut,
      nights: original.nights,
      adults: original.adults,
      children: original.children,
      rooms: original.rooms,
      roomType: original.roomType,
      bedType: original.bedType,
      currency: original.currency,
      taxRateBps: original.taxRateBps,
      realizationPct: original.realizationPct,
      // The unchanged input — recompute re-runs the rules, not the facts.
      contextSnapshot: original.contextSnapshot,
      resultSnapshot: outcome.results,
      engineVersion: outcome.engineVersion,
      status: 'DRAFT',
      chosenChannel: null,
      quotes: original.quotes.map((quote) => ({
        channel: quote.channel,
        label: quote.label,
        totalCents: quote.totalCents,
        prepaid: quote.prepaid,
        refundable: quote.refundable,
        sourceUrl: quote.sourceUrl,
        capturedAt: quote.capturedAt,
        sortIndex: quote.sortIndex,
      })),
      competingRate: original.competingRates[0]
        ? {
            siteDomain: original.competingRates[0].siteDomain,
            url: original.competingRates[0].url,
            baseCents: original.competingRates[0].baseCents,
            taxCents: original.competingRates[0].taxCents,
            refundable: original.competingRates[0].refundable,
            publiclyAvailable: original.competingRates[0].publiclyAvailable,
            roomType: original.competingRates[0].roomType,
            bedType: original.competingRates[0].bedType,
            adults: original.competingRates[0].adults,
            children: original.competingRates[0].children,
            currency: original.competingRates[0].currency,
            capturedAt: original.competingRates[0].capturedAt,
          }
        : null,
    });

    this.deps.metrics.increment('comparison.recomputed');
    logger.info('comparison recomputed into a new row — original left untouched', {
      originalId: original.id,
      newId: created.id,
      originalEngineVersion: original.engineVersion,
      newEngineVersion: created.engineVersion,
      winnerChanged: original.resultSnapshot.find((r) => r.channel === outcome.winner?.channel) === undefined,
    });

    return created;
  }
}
