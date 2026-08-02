import type { Cents } from '../shared/cents';
import { CHANNEL_DEFINITIONS } from '../rules/channels.rules';
import { evaluateChannel, buildQuoteLabels } from './channel-evaluator';
import { rankResults } from './ranking';
import { evaluateBrg, type BrgOptions } from './brg';
import { analyseSensitivity } from './sensitivity';
import { NULL_PROFILER, type EngineProfiler } from './profiler';
import { ENGINE_VERSION } from './version';
import type {
  BrgResult,
  ChannelQuote,
  ChannelResult,
  ComparisonResult,
  EngineWarning,
  StayContext,
} from './types';

export interface CompareInput {
  readonly context: StayContext;
  readonly quotes: readonly ChannelQuote[];
  readonly brgOptions?: BrgOptions;
}

export interface SavingsEngineOptions {
  /** Off by default; the disabled profiler reads no clock at all. */
  readonly profiler?: EngineProfiler;
  /** Sensitivity is a bisection over many evaluations — skippable on hot paths. */
  readonly includeSensitivity?: boolean;
}

/**
 * `SavingsEngine` — the domain service that fronts the pure engine.
 *
 * The arithmetic lives in the free functions in this directory, because §3
 * requires a pure, dependency-free module and because the §3.8 fixtures test
 * those functions directly. This class is the object-oriented seam around them:
 * it holds configuration, orders the steps, and is what the application layer
 * injects and measures. It owns no arithmetic of its own.
 *
 * That split is deliberate — DECISIONS.md D-030. Neither layer is compromised:
 * the functions have no `this`, and this class has no formulas.
 *
 * §5.3: the client and the server import *this same module*. The math is never
 * forked into two implementations.
 */
export class SavingsEngine {
  private readonly profiler: EngineProfiler;
  private readonly includeSensitivity: boolean;

  constructor(options: SavingsEngineOptions = {}) {
    this.profiler = options.profiler ?? NULL_PROFILER;
    this.includeSensitivity = options.includeSensitivity ?? true;
  }

  public get version(): string {
    return ENGINE_VERSION;
  }

  /**
   * Ranks every channel by effective net cost and reports what the choice
   * costs or saves against every alternative.
   */
  public compare(input: CompareInput): ComparisonResult {
    const { context, quotes } = input;

    const results = this.measure('evaluate', () => {
      const labels = buildQuoteLabels(quotes);
      return quotes.map((quote, index) => evaluateChannel(quote, context, index, labels[index]));
    });

    const ranked = this.measure('rank', () => rankResults(results));
    const winner = ranked[0]?.result ?? null;

    const brg = this.measure('brg', () => this.bestBrg(results, context, input.brgOptions));

    const sensitivity = this.includeSensitivity
      ? this.measure('sensitivity', () => analyseSensitivity(quotes, context))
      : null;

    const warnings: EngineWarning[] = [];

    // §8.7 — when the win rests on a points valuation rather than on cash, say so.
    if (sensitivity?.pointsDominates) {
      warnings.push('POINTS_DOMINATES');
    }

    // §3.5 — the chain guarantee is a *fork*, never an addition. This warning
    // fires only when taking that fork would genuinely beat the current winner,
    // and the UI is required to render the two as mutually exclusive.
    if (brg !== null && winner !== null && brg.newTotalCents < winner.effectiveNetCents) {
      warnings.push('BRG_AVAILABLE_NOT_TAKEN');
    }

    return {
      results: Object.freeze(results),
      ranked,
      winner,
      warnings: Object.freeze(warnings),
      brg,
      sensitivity,
      engineVersion: ENGINE_VERSION,
    };
  }

  /** Evaluates a single quote. Exposed for the §7.3 per-figure formula hover. */
  public evaluateOne(quote: ChannelQuote, context: StayContext, index = 0): ChannelResult {
    return evaluateChannel(quote, context, index);
  }

  /**
   * Evaluates the chain guarantee against the cheapest direct quote.
   *
   * A best-rate guarantee requires booking direct with the chain, so without a
   * direct rate there is nothing to evaluate — the UI prompts for one rather
   * than the engine inventing a figure.
   */
  private bestBrg(
    results: readonly ChannelResult[],
    context: StayContext,
    options?: BrgOptions,
  ): BrgResult | null {
    if (context.brand === 'NONE') return null;

    const directQuotes = results.filter((r) => CHANNEL_DEFINITIONS[r.channel].brgEligible);
    if (directQuotes.length === 0) return null;

    const cheapestDirect = directQuotes.reduce((best, candidate) =>
      candidate.totalCents < best.totalCents ? candidate : best,
    );

    return evaluateBrg(
      cheapestDirect.totalCents as Cents,
      context,
      context.brand,
      options ?? {},
    );
  }

  /**
   * Times a step through the injected profiler. With the default `NULL_PROFILER`
   * both `now()` calls return a constant, so nothing is read and nothing is
   * recorded — the engine stays pure unless profiling is explicitly asked for.
   */
  private measure<T>(step: string, fn: () => T): T {
    const start = this.profiler.now();
    const value = fn();
    this.profiler.record(step, this.profiler.now() - start);
    return value;
  }
}

/**
 * A shared default instance for callers that need no configuration.
 * Stateless, so sharing it is safe.
 */
export const savingsEngine = new SavingsEngine();
