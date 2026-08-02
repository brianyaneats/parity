import type { Cents } from '../shared/cents';
import { ZERO_CENTS, cents, sumCents } from '../shared/cents';
import type { Channel } from '../rules/channels.rules';
import { CHANNEL_DEFINITIONS } from '../rules/channels.rules';

export interface PerksInput {
  readonly channel: Channel;
  readonly nights: number;
  readonly breakfastPerDayCents: Cents;
  readonly propertyCreditFaceCents: Cents;
  /** 0..100. */
  readonly realizationPct: number;
}

export interface PerksOutcome {
  readonly breakfastCents: Cents;
  readonly propertyCreditCents: Cents;
  readonly totalCents: Cents;
}

/**
 * Perks valuation — §3.3 step 3, §2.6.
 *
 * ```
 * breakfast = breakfastPerDay × nights
 * property  = round(propertyCreditFace × realizationPct / 100)
 * perks     = breakfast + property
 * ```
 *
 * Applies only to the three channels that grant portal perks (`FHR`, `THC`,
 * `EDIT`). Note that `CHASE_TRAVEL` does **not**, despite being a Chase portal —
 * only The Edit carries them.
 *
 * The realization percentage is what keeps this honest. A $100 dining credit at
 * a hotel where the user will eat is worth $100; a spa-only credit for someone
 * who will not book a treatment is worth far less, and §13.3 warns that
 * uncritical perk valuations are the easiest way to make this app produce
 * nonsense.
 */
export function perksFor(input: PerksInput): PerksOutcome {
  if (!CHANNEL_DEFINITIONS[input.channel].grantsPortalPerks) {
    return {
      breakfastCents: ZERO_CENTS,
      propertyCreditCents: ZERO_CENTS,
      totalCents: ZERO_CENTS,
    };
  }

  const breakfastCents = cents(input.breakfastPerDayCents * input.nights);
  const propertyCreditCents = cents((input.propertyCreditFaceCents * input.realizationPct) / 100);

  return {
    breakfastCents,
    propertyCreditCents,
    totalCents: sumCents(breakfastCents, propertyCreditCents),
  };
}
