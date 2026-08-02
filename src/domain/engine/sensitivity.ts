import { roundHalfAwayFromZero, subtractCents, type Cents } from '../shared/cents';
import { POINTS_DOMINANCE_THRESHOLD_PCT } from '../rules/points.rules';
import { evaluateChannel } from './channel-evaluator';
import { rankResults, compareResults } from './ranking';
import type { Channel, ChannelQuote, SensitivityReport, StayContext } from './types';

/** Bisection iterations. 60 is far past double precision on these ranges. */
const BISECTION_STEPS = 60;

/** Upper bound of the search, in micro-cents per point. 10¢ is beyond plausible. */
const MAX_SEARCH_MICRO = 100_000;

/**
 * Sensitivity analysis — §8.7.
 *
 * Answers the two questions that make a ranking trustworthy rather than merely
 * confident:
 *
 * 1. **At what point valuation does the winner change?** Binary-searched one
 *    parameter at a time with the others held fixed. For TC-01 the answer is
 *    UR ≈ 0.44¢, and the spec requires the reported figure to land within
 *    ±0.01¢ of it.
 * 2. **What share of the winner's advantage is points versus cash?** When more
 *    than 40% of the advantage is point value, the win rests on an assumption
 *    rather than on money, and the user is told so plainly.
 *
 * This exists because §13.3 identifies inflated valuations as a way to make the
 * app produce nonsense. It is a scope cut the spec explicitly forbids.
 */
export function analyseSensitivity(
  quotes: readonly ChannelQuote[],
  ctx: StayContext,
): SensitivityReport | null {
  const ranked = rankResults(quotes.map((q, i) => evaluateChannel(q, ctx, i)));
  const winnerEntry = ranked[0];
  // Empty quote set: nothing to be sensitive about.
  if (!winnerEntry) return null;

  const winner = winnerEntry.result;
  const runnerUpEntry = ranked[1];
  const runnerUp = runnerUpEntry?.result ?? null;

  const advantageCents = runnerUp
    ? subtractCents(runnerUp.effectiveNetCents, winner.effectiveNetCents)
    : (0 as Cents);

  // How much of the winner's lead is point value rather than cash. Comparing
  // the *delta* rather than the winner's raw points is what makes this
  // meaningful — a channel whose rival earns just as many points does not owe
  // its win to points at all.
  const pointsDelta = runnerUp
    ? winner.pointsValueCents - runnerUp.pointsValueCents
    : winner.pointsValueCents;

  const pointsShareOfAdvantageBps =
    advantageCents > 0 ? roundHalfAwayFromZero((pointsDelta * 10_000) / advantageCents) : 0;

  const pointsDominates =
    advantageCents > 0 && pointsShareOfAdvantageBps > POINTS_DOMINANCE_THRESHOLD_PCT * 100;

  return {
    winner: winner.channel,
    runnerUp: runnerUp?.channel ?? null,
    advantageCents,
    pointsShareOfAdvantageBps,
    pointsDominates,
    urBreakEvenMicro: findBreakEven(quotes, ctx, 'ur', winner.channel),
    mrBreakEvenMicro: findBreakEven(quotes, ctx, 'mr', winner.channel),
  };
}

type ValuationParam = 'ur' | 'mr';

/**
 * Finds the valuation at which the winning channel changes, or `null` if it
 * never does anywhere in the searchable range.
 *
 * Searches downward first — the interesting direction, since a *lower* points
 * valuation is the sceptical case and the one that tests whether a win is real.
 */
function findBreakEven(
  quotes: readonly ChannelQuote[],
  ctx: StayContext,
  param: ValuationParam,
  currentWinner: Channel,
): number | null {
  const current = param === 'ur' ? ctx.urValueMicro : ctx.mrValueMicro;

  // Reduces to the best entry rather than sorting and indexing. Seedless
  // `reduce` on a non-empty array returns the element type directly, so there
  // is no undefined case to guard — and it is O(n) rather than O(n log n),
  // which matters across sixty bisection steps.
  const winnerAt = (value: number): Channel => {
    const nextCtx: StayContext =
      param === 'ur' ? { ...ctx, urValueMicro: value } : { ...ctx, mrValueMicro: value };
    return quotes
      .map((q, i) => evaluateChannel(q, nextCtx, i))
      .reduce((best, candidate) => (compareResults(candidate, best) < 0 ? candidate : best))
      .channel;
  };

  // Downward: does devaluing points to zero hand the win to someone else?
  if (current > 0 && winnerAt(0) !== currentWinner) {
    return bisect(winnerAt, currentWinner, 0, current, 'winnerAtHigh');
  }

  // Upward: does inflating points hand the win to someone else?
  const ceiling = Math.max(MAX_SEARCH_MICRO, current * 4);
  if (winnerAt(ceiling) !== currentWinner) {
    return bisect(winnerAt, currentWinner, current, ceiling, 'winnerAtLow');
  }

  return null;
}

/**
 * Bisects for the boundary between "current winner still wins" and "it does
 * not". `holds` names which end of the interval the current winner holds.
 */
function bisect(
  winnerAt: (value: number) => Channel | null,
  currentWinner: Channel,
  low: number,
  high: number,
  holds: 'winnerAtHigh' | 'winnerAtLow',
): number {
  let a = low;
  let b = high;

  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const mid = (a + b) / 2;
    const stillWinning = winnerAt(mid) === currentWinner;

    if (holds === 'winnerAtHigh') {
      // Winner holds the top of the range; the flip is somewhere below.
      if (stillWinning) b = mid;
      else a = mid;
    } else {
      // Winner holds the bottom of the range; the flip is somewhere above.
      if (stillWinning) a = mid;
      else b = mid;
    }
  }

  return (a + b) / 2;
}
