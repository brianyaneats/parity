import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import type { Channel, ChannelQuote, StayContext } from '@/domain/engine/types';

/**
 * The §7.8 "honesty feature" — "at this valuation, N of your saved
 * comparisons change winner."
 *
 * Pure and dependency-free on purpose (no `db`, no `next/*`): it is imported
 * by the `'use client'` `SettingsScreen` and re-run on every keystroke as the
 * user drags the MR/UR valuation, so it has to be cheap and safe to bundle for
 * the browser. The one-time cost of loading each saved comparison's snapshot
 * from Postgres lives in `data.ts`; this module only re-ranks what it is
 * handed.
 */

const engine = new SavingsEngine({ includeSensitivity: false });

/**
 * Everything needed to re-rank one saved comparison under a different point
 * valuation. `context`/`quotes` are reconstructed from `comparisons` +
 * `quotes` rows in `data.ts`; `originalWinner` is read straight off the
 * comparison's immutable `resultSnapshot` (§4.3) via `winnerOf`, not
 * recomputed, so it reflects exactly what the user saw at the time.
 */
export interface SavedComparisonSummary {
  readonly id: string;
  readonly propertyLabel: string;
  readonly originalWinner: Channel | null;
  readonly context: StayContext;
  readonly quotes: readonly ChannelQuote[];
}

export interface SensitivityOutcome {
  readonly total: number;
  readonly changed: number;
  /** Which saved comparisons flip, for the "show me which ones" disclosure. */
  readonly changedComparisons: readonly {
    readonly id: string;
    readonly propertyLabel: string;
    readonly from: Channel | null;
    readonly to: Channel | null;
  }[];
}

/**
 * Re-evaluates every saved comparison at a candidate MR/UR valuation and
 * counts how many would rank a different channel first.
 *
 * §7.8 calls this "the honesty feature and it is worth the query": a user
 * editing the point-valuation assumption (§2.5's "most contestable assumption
 * in the model") deserves to know, immediately, whether their past decisions
 * would have gone differently — not just that the numbers moved.
 */
export function countChangedWinners(
  comparisons: readonly SavedComparisonSummary[],
  mrValueMicro: number,
  urValueMicro: number,
): SensitivityOutcome {
  const changedComparisons: {
    id: string;
    propertyLabel: string;
    from: Channel | null;
    to: Channel | null;
  }[] = [];

  for (const comparison of comparisons) {
    const ctx: StayContext = { ...comparison.context, mrValueMicro, urValueMicro };
    const recomputedWinner = engine.compare({ context: ctx, quotes: comparison.quotes }).winner?.channel ?? null;

    if (recomputedWinner !== comparison.originalWinner) {
      changedComparisons.push({
        id: comparison.id,
        propertyLabel: comparison.propertyLabel,
        from: comparison.originalWinner,
        to: recomputedWinner,
      });
    }
  }

  return {
    total: comparisons.length,
    changed: changedComparisons.length,
    changedComparisons: Object.freeze(changedComparisons),
  };
}
