import type { Cents } from '../shared/cents';
import type { Channel, BrandOrNone, ChainBrand } from '../rules/channels.rules';
import type { PmCondition } from '../rules/price-match.rules';

export type { Channel, ChainBrand, BrandOrNone, PmCondition };

/**
 * Engine types — §3.2.
 *
 * Everything here is plain data. No classes, no methods, no `Date`. The engine
 * is a pure function of these values, which is what makes the §3.8 fixtures
 * expressible as a JSON table and what makes `POST /api/compare` and the
 * client-side optimistic compute provably the same computation (§5.3).
 */

export interface StayContext {
  /** ≥ 1. Rejected at validation; the engine throws if it ever sees less. */
  readonly nights: number;
  /** Basis points. `1240` = 12.40%. `0` is legal — some jurisdictions and rate types. */
  readonly taxRateBps: number;
  readonly breakfastPerDayCents: Cents;
  readonly propertyCreditFaceCents: Cents;
  /** 0..100. The fraction of the on-property credit the user will genuinely spend. */
  readonly realizationPct: number;
  /** Micro-cents per Membership Rewards point. `15000` = 1.5¢. */
  readonly mrValueMicro: number;
  /** Micro-cents per Ultimate Rewards point. `17500` = 1.75¢. */
  readonly urValueMicro: number;
  readonly foraRateBps: number;
  readonly amexBucketAvailable: boolean;
  readonly editBucketAvailable: boolean;
  /** `null` means "no competing rate entered" — not an error, see §3.6. */
  readonly competitorBaseCents: Cents | null;
  readonly competitorRefundable: boolean;
  readonly competitorPublic: boolean;
  readonly brand: BrandOrNone;
}

export interface ChannelQuote {
  readonly channel: Channel;
  /** The total the channel quotes, **including** tax and fees. */
  readonly totalCents: Cents;
  readonly prepaid: boolean;
  readonly refundable: boolean;
  /** Optional user label. Duplicates are auto-labelled by index — §3.6, D-019. */
  readonly label?: string;
}

/**
 * §3.7 — warnings are structured, not strings, so the UI renders them
 * consistently and tests can assert on them.
 */
export type EngineWarning =
  /** FHR (or THC) not prepaid → 5× forfeited, earning 1× instead. */
  | 'FHR_PAY_AT_PROPERTY_1X'
  /** An Edit or Hotel Collection stay under two nights → credit cannot unlock. */
  | 'EDIT_UNDER_TWO_NIGHTS'
  /** A price-match refund dragged the charge below the credit face. */
  | 'CLAWBACK_RISK'
  /** Perks plus credits plus refund exceed the room cost — check the assumptions. */
  | 'OVER_SUBSIDIZED'
  /** A real gap exists but the competing rate fails PM8 or PM9. */
  | 'COMPETITOR_NON_REFUNDABLE'
  /** An Amex portal quote sits alongside a real gap it can never claim against. */
  | 'FHR_NO_PRICE_MATCH'
  /** Booking direct and claiming the chain guarantee would beat the current winner. */
  | 'BRG_AVAILABLE_NOT_TAKEN'
  /** More than 40% of the winner's advantage is speculative point value. */
  | 'POINTS_DOMINATES';

export interface PriceMatchAssessment {
  /** Whether the channel itself is reachable by Chase's programme at all (PM2). */
  readonly channelEligible: boolean;
  /**
   * Which conditions failed. Drives the §8.2 checklist.
   *
   * The pure engine can only decide PM2, PM3, PM7, PM8 and PM9 — it has no
   * clock and no card. PM1, PM4, PM5 and PM6 are evaluated in the application
   * layer and merged into this same array before it reaches the UI.
   * See DECISIONS.md D-016.
   */
  readonly failedConditions: readonly PmCondition[];
  /** Own base minus competitor base. Negative when the own rate is already lower. */
  readonly gapCents: Cents;
  readonly perNightCents: Cents;
  readonly qualifies: boolean;
  /** The full gap, as an **estimate**. Partial approval is common — §2.3.1. */
  readonly estimatedRefundCents: Cents;
  /** `face + expectedRefund`. Charge at least this in cash — §2.4, §8.3. */
  readonly minCashFloorCents: Cents;
}

export interface ChannelResult {
  readonly channel: Channel;
  /** Position in the input array. Duplicates are allowed and labelled — §3.6. */
  readonly quoteIndex: number;
  /** Display label; carries a `(1)`, `(2)` suffix only when the channel repeats. */
  readonly label: string;

  readonly totalCents: Cents;
  readonly baseCents: Cents;
  readonly taxCents: Cents;

  readonly perksCents: Cents;
  readonly breakfastCents: Cents;
  readonly propertyCreditCents: Cents;

  readonly creditFaceCents: Cents;
  readonly creditKeptCents: Cents;
  readonly clawbackCents: Cents;

  readonly pointsValueCents: Cents;
  readonly pointsEarned: number;

  readonly refundCents: Cents;
  readonly rebateCents: Cents;

  /** MAY BE NEGATIVE — §3.6. The UI clamps bar length, never the printed value. */
  readonly effectiveNetCents: Cents;
  readonly effectiveNightlyCents: Cents;

  readonly prepaid: boolean;
  readonly refundable: boolean;

  readonly priceMatch: PriceMatchAssessment;
  readonly warnings: readonly EngineWarning[];
}

export interface BrgResult {
  readonly brand: ChainBrand;
  readonly label: string;
  /** The competitor base after the brand's discount kicker. */
  readonly matchedBaseCents: Cents;
  /** `matchedBase × (1 + taxRateBps/10000)`. */
  readonly newTotalCents: Cents;
  /** What the direct booking would have cost without the claim. */
  readonly originalTotalCents: Cents;
  readonly savingCents: Cents;
  readonly pointsKicker: number;
  readonly giftCardCents: Cents;
  readonly discountBps: number;
  readonly payoutDescription: string;
  readonly exclusions: string;
  readonly frequencyLimit: string | null;
  readonly claimWindowHours: number;
}

export interface RankedEntry {
  readonly result: ChannelResult;
  readonly rank: number;
  /** Cents worse than the winner. Zero for the winner itself. */
  readonly deltaFromWinnerCents: Cents;
}

/**
 * §8.7 — how robust is this result?
 *
 * Two questions: at what point valuation does the winner change, and what
 * share of the winner's advantage is points rather than cash.
 */
export interface SensitivityReport {
  readonly winner: Channel;
  readonly runnerUp: Channel | null;
  /** Cents by which the winner beats the runner-up. */
  readonly advantageCents: Cents;
  /** How much of that advantage comes from the points delta, in basis points. */
  readonly pointsShareOfAdvantageBps: number;
  readonly pointsDominates: boolean;
  /** Micro-cents per UR point at which the winner flips. `null` if it never does. */
  readonly urBreakEvenMicro: number | null;
  /** Micro-cents per MR point at which the winner flips. `null` if it never does. */
  readonly mrBreakEvenMicro: number | null;
}

export interface ComparisonResult {
  readonly results: readonly ChannelResult[];
  readonly ranked: readonly RankedEntry[];
  readonly winner: ChannelResult | null;
  /** Comparison-level warnings. Per-channel ones live on each `ChannelResult`. */
  readonly warnings: readonly EngineWarning[];
  readonly brg: BrgResult | null;
  readonly sensitivity: SensitivityReport | null;
  readonly engineVersion: string;
}
