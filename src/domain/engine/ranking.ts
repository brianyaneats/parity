import { subtractCents } from '../shared/cents';
import { CHANNEL_RANK_ORDER } from '../rules/channels.rules';
import type { ChannelResult, RankedEntry } from './types';

/**
 * Ranking and tie-breaks — §3.4.
 *
 * Sort ascending by `effectiveNetCents`. Ties break by, in order:
 *
 *   (a) refundable before non-refundable — optionality has real value and the
 *       re-shop feature in §7.6 depends on it;
 *   (b) higher `pointsValueCents`;
 *   (c) channel enum order as listed in §2.2.
 *
 * Determinism is a product requirement, not a nicety: "the same input always
 * produces the same order, because the user will notice if the winner flips
 * between page loads." The final tie-break on `quoteIndex` guarantees a total
 * order even for two identical quotes on the same channel, so `sort` stability
 * is never something we have to rely on.
 */
export function rankResults(results: readonly ChannelResult[]): readonly RankedEntry[] {
  const ordered = [...results].sort(compareResults);
  const [winner] = ordered;
  if (!winner) return Object.freeze([]);

  return Object.freeze(
    ordered.map((result, index) => ({
      result,
      rank: index + 1,
      deltaFromWinnerCents: subtractCents(result.effectiveNetCents, winner.effectiveNetCents),
    })),
  );
}

export function compareResults(a: ChannelResult, b: ChannelResult): number {
  // Primary: effective net cost, ascending. Cheapest wins.
  if (a.effectiveNetCents !== b.effectiveNetCents) {
    return a.effectiveNetCents - b.effectiveNetCents;
  }

  // (a) Refundable before non-refundable.
  if (a.refundable !== b.refundable) {
    return a.refundable ? -1 : 1;
  }

  // (b) Higher points value first.
  if (a.pointsValueCents !== b.pointsValueCents) {
    return b.pointsValueCents - a.pointsValueCents;
  }

  // (c) Channel order as listed in §2.2.
  const aRank = CHANNEL_RANK_ORDER.indexOf(a.channel);
  const bRank = CHANNEL_RANK_ORDER.indexOf(b.channel);
  if (aRank !== bRank) return aRank - bRank;

  // Total order for duplicate quotes on the same channel, so the result never
  // depends on the input array's incidental order.
  return a.quoteIndex - b.quoteIndex;
}

export function winnerOf(results: readonly ChannelResult[]): ChannelResult | null {
  const ranked = rankResults(results);
  return ranked[0]?.result ?? null;
}
