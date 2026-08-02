import type { Cents } from '../shared/cents';
import { ZERO_CENTS, atLeastZero, subtractCents, valuePoints, applyBps } from '../shared/cents';
import type { Channel } from '../rules/channels.rules';
import { POINTS_EARNING, OTA_LOYALTY_RATE_BPS_RULE } from '../rules/points.rules';

export interface PointsInput {
  readonly channel: Channel;
  readonly prepaid: boolean;
  readonly totalCents: Cents;
  readonly netChargeCents: Cents;
  readonly creditKeptCents: Cents;
  readonly mrValueMicro: number;
  readonly urValueMicro: number;
}

export interface PointsOutcome {
  /** Cash value of the points earned. */
  readonly valueCents: Cents;
  /** Whole points earned, for display. */
  readonly points: number;
  /** The spend the multiplier was applied to. Shown in the §7.3 formula hover. */
  readonly earningBaseCents: Cents;
  readonly multiplier: number;
}

/**
 * `pointsFor` — §3.3 step 12, table in §2.5.
 *
 * Two rules carry all the weight:
 *
 * - **FHR/THC pay-at-property earns 1×, not 5×.** §2.5 calls it "a common and
 *   expensive mistake". On TC-01's $3,600 FHR quote that is $216 of Membership
 *   Rewards quietly forfeited, which is why it gets its own warning.
 * - **The Chase channels earn on `netCharge − creditKept`** — only the portion
 *   no statement credit covered. Earning on the full total would overstate
 *   every Edit comparison in the product.
 */
export function pointsFor(input: PointsInput): PointsOutcome {
  const { channel, prepaid, totalCents, netChargeCents, creditKeptCents } = input;
  const rule = POINTS_EARNING[channel];

  if (rule.currency === 'NONE') {
    return { valueCents: ZERO_CENTS, points: 0, earningBaseCents: ZERO_CENTS, multiplier: 0 };
  }

  // §2.2 models OTA loyalty as a flat cash-equivalent rebate on the total, not
  // as a points currency with a user-set valuation.
  if (rule.currency === 'CASH_EQUIVALENT') {
    return {
      valueCents: applyBps(totalCents, OTA_LOYALTY_RATE_BPS_RULE.value),
      points: 0,
      earningBaseCents: totalCents,
      multiplier: 0,
    };
  }

  const multiplier = prepaid ? rule.prepaidMultiplier : rule.payAtPropertyMultiplier;

  // Only the Chase channels net the credit off the earning base.
  const earningBaseCents = rule.earnsNetOfCredit
    ? atLeastZero(subtractCents(netChargeCents, creditKeptCents))
    : totalCents;

  const valueMicro = rule.currency === 'UR' ? input.urValueMicro : input.mrValueMicro;

  return {
    valueCents: valuePoints(earningBaseCents, multiplier, valueMicro),
    // Points per dollar: cents ÷ 100 × multiplier.
    points: Math.round((earningBaseCents * multiplier) / 100),
    earningBaseCents,
    multiplier,
  };
}

/**
 * Whether this quote forfeits the 5× prepaid rate by paying at the property.
 * Drives `FHR_PAY_AT_PROPERTY_1X`.
 */
export function forfeitsPrepaidMultiplier(channel: Channel, prepaid: boolean): boolean {
  const rule = POINTS_EARNING[channel];
  return !prepaid && rule.currency === 'MR' && rule.prepaidMultiplier > rule.payAtPropertyMultiplier;
}
