import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import { cents } from '@/domain/shared/cents';
import type { Logger } from '@/infrastructure/observability/Logger';
import type { CreateComparisonInput as ValidatedCreateComparisonInput } from '@/lib/validation/comparisons';
import type { ComparisonRecord, ComparisonRepository } from '@/application/ports/ComparisonRepository';
import { toStayContext, toChannelQuotes } from '../mappers/compare-mapper';
import { CommandUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface CreateComparisonInput extends ValidatedCreateComparisonInput {
  readonly userId: string;
}

/**
 * `POST /api/comparisons` — §5.2.
 *
 * "Persist a comparison + quotes + competing rate. Returns the row with
 * snapshots." The snapshot is computed here, from the *current* engine, the
 * same way `CompareChannelsUseCase` does it (§5.3: one engine module, never
 * forked) — the client is not trusted to hand back its own optimistic
 * results, because a saved comparison is the record §4.3 makes auditable, and
 * an auditable record has to be computed server-side.
 */
export class CreateComparisonUseCase extends CommandUseCase<CreateComparisonInput, ComparisonRecord> {
  public readonly name = 'create_comparison';

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
    input: CreateComparisonInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<ComparisonRecord> {
    const context = toStayContext(input.context);
    const quotes = toChannelQuotes(input.quotes);
    const outcome = this.engine.compare({ context, quotes });

    const record = await this.comparisons.create({
      userId: input.userId,
      tripId: input.tripId ?? null,
      propertyId: input.propertyId ?? null,
      propertyNameSnapshot: input.propertyNameSnapshot,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights: context.nights,
      ...(input.adults !== undefined ? { adults: input.adults } : {}),
      ...(input.children !== undefined ? { children: input.children } : {}),
      ...(input.rooms !== undefined ? { rooms: input.rooms } : {}),
      roomType: input.roomType ?? null,
      bedType: input.bedType ?? null,
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      taxRateBps: context.taxRateBps,
      realizationPct: context.realizationPct,
      contextSnapshot: context,
      resultSnapshot: outcome.results,
      engineVersion: outcome.engineVersion,
      ...(input.status !== undefined ? { status: input.status } : {}),
      chosenChannel: input.chosenChannel ?? null,
      quotes: quotes.map((quote, index) => ({
        channel: quote.channel,
        ...(quote.label !== undefined ? { label: quote.label } : {}),
        totalCents: quote.totalCents,
        prepaid: quote.prepaid,
        refundable: quote.refundable,
        sortIndex: index,
      })),
      competingRate: input.competingRate
        ? {
            siteDomain: input.competingRate.siteDomain,
            url: input.competingRate.url,
            baseCents: cents(input.competingRate.baseCents),
            taxCents: input.competingRate.taxCents != null ? cents(input.competingRate.taxCents) : null,
            refundable: input.competingRate.refundable,
            publiclyAvailable: input.competingRate.publiclyAvailable,
            roomType: input.competingRate.roomType ?? null,
            bedType: input.competingRate.bedType ?? null,
            adults: input.competingRate.adults ?? null,
            children: input.competingRate.children ?? null,
            currency: input.competingRate.currency ?? null,
            capturedAt: input.competingRate.capturedAt ? new Date(input.competingRate.capturedAt) : ctx.now,
          }
        : null,
    });

    this.deps.metrics.increment('comparison.created', { status: record.status });
    logger.info('comparison persisted', {
      comparisonId: record.id,
      winner: outcome.winner?.channel ?? null,
      engineVersion: outcome.engineVersion,
    });

    return record;
  }

  protected override describeInput(input: CreateComparisonInput) {
    return { quoteCount: input.quotes.length, nights: input.context.nights, hasTrip: input.tripId != null };
  }
}
