import type { Logger, LogFields } from '@/infrastructure/observability/Logger';
import type { Metrics } from '@/infrastructure/observability/MetricsRegistry';
import type { Clock } from '@/domain/shared/Clock';
import type { DomainEvent } from '@/domain/shared/DomainEvent';

/**
 * The instrumented use-case base — DECISIONS.md D-040.
 *
 * The owner asked for logging and performance metrics on *each task*. The
 * failure mode of that requirement is obvious and universal: instrumentation
 * gets added to the first three handlers and forgotten on the fourth. So it is
 * not a convention here, it is structural.
 *
 * `execute()` is the only public entry point and it is not overridden by
 * subclasses. It wraps the subclass's `handle()` with a timer, a start/success/
 * failure log line carrying the request id, a latency histogram, outcome
 * counters, and a budget check. A subclass physically cannot run without being
 * measured.
 *
 * `handle()` is `protected abstract`, so the only way to add behaviour is
 * inside the instrumented envelope.
 */

export interface ExecutionContext {
  /** Every query is scoped by this. Multi-tenant from day one — §1.2. */
  readonly userId: string;
  /** Correlates every log line for one user action. Returned in `X-Request-Id`. */
  readonly requestId: string;
  /** Read once from the injected clock so every step of one task agrees on "now". */
  readonly now: Date;
}

export interface UseCaseDependencies {
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly clock: Clock;
}

/** Something that dispatches the events an aggregate recorded. */
export interface DomainEventDispatcher {
  dispatch(events: readonly DomainEvent[], ctx: ExecutionContext): Promise<void>;
}

export abstract class UseCase<TInput, TOutput> {
  /** Stable name. Becomes the metric label and the log field — never rename casually. */
  public abstract readonly name: string;

  /**
   * Latency budget in milliseconds. Exceeding it logs a warning with the
   * measured duration rather than failing the request — a slow answer is still
   * an answer, but it should be visible. `POST /api/compare` sets this to the
   * 100 ms p95 from §5.3.
   */
  protected readonly budgetMs: number | null = null;

  constructor(protected readonly deps: UseCaseDependencies) {}

  /**
   * Runs the use case, instrumented. Not overridable by convention — override
   * `handle` instead.
   */
  public async execute(input: TInput, ctx: ExecutionContext): Promise<TOutput> {
    const logger = this.deps.logger.child({
      useCase: this.name,
      requestId: ctx.requestId,
      userId: ctx.userId,
    });

    const labels = { usecase: this.name } as const;
    const started = performance.now();

    logger.debug('use case started', this.describeInput(input));
    this.deps.metrics.increment('usecase.invocations', labels);

    try {
      const output = await this.handle(input, ctx, logger);
      const durationMs = performance.now() - started;

      this.deps.metrics.observe('usecase.duration_ms', durationMs, labels);
      this.deps.metrics.increment('usecase.outcome', { ...labels, outcome: 'success' });

      if (this.budgetMs !== null && durationMs > this.budgetMs) {
        // Named number and consequence in the same line, per §13.1's copy rule —
        // this is a log line a human reads during an incident.
        logger.warn('use case exceeded its latency budget', {
          durationMs: Math.round(durationMs),
          budgetMs: this.budgetMs,
          overBy: Math.round(durationMs - this.budgetMs),
        });
        this.deps.metrics.increment('usecase.budget_exceeded', labels);
      } else {
        logger.info('use case succeeded', { durationMs: Math.round(durationMs) });
      }

      return output;
    } catch (error) {
      const durationMs = performance.now() - started;

      // Recorded on the failure path too: a use case that is slow *because* it
      // is failing is exactly the sample you want, and dropping it makes an
      // incident look like a latency improvement.
      this.deps.metrics.observe('usecase.duration_ms', durationMs, labels);
      this.deps.metrics.increment('usecase.outcome', { ...labels, outcome: 'failure' });

      logger.error('use case failed', error, {
        durationMs: Math.round(durationMs),
        ...this.describeInput(input),
      });
      throw error;
    }
  }

  /**
   * The actual work. Receives the already-scoped logger so anything it logs is
   * automatically correlated to this task.
   */
  protected abstract handle(
    input: TInput,
    ctx: ExecutionContext,
    logger: Logger,
  ): Promise<TOutput>;

  /**
   * Fields describing the input, for the start and failure log lines.
   *
   * Defaults to nothing rather than to the whole input: §12 treats the user's
   * hotel list as sensitive, so a use case opts in to what it reveals. The
   * logger's redaction pass runs on whatever is returned regardless.
   */
  protected describeInput(_input: TInput): LogFields {
    return {};
  }
}

/**
 * A use case that reads. Semantically identical, but the separate base makes
 * the read/write split visible in the type and lets a future caller route reads
 * to a replica without auditing every class.
 */
export abstract class QueryUseCase<TInput, TOutput> extends UseCase<TInput, TOutput> {}

/**
 * A use case that writes and may raise domain events.
 *
 * Aggregates record what happened; this drains and dispatches it in the same
 * logical transaction. `BookingRecorded` → auto-created claim (§5.2) is the one
 * that matters in v1 — it makes the claim a consequence of the domain rather
 * than a side effect buried in a route handler.
 */
export abstract class CommandUseCase<TInput, TOutput> extends UseCase<TInput, TOutput> {
  protected async publish(
    events: readonly DomainEvent[],
    ctx: ExecutionContext,
    dispatcher: DomainEventDispatcher | undefined,
    logger: Logger,
  ): Promise<void> {
    if (events.length === 0 || !dispatcher) return;

    logger.debug('dispatching domain events', {
      count: events.length,
      types: events.map((event) => event.type),
    });
    this.deps.metrics.increment('domain.events_published', { usecase: this.name }, events.length);

    await dispatcher.dispatch(events, ctx);
  }
}
