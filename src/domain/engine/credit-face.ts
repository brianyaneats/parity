import type { Cents } from '../shared/cents';
import { ZERO_CENTS } from '../shared/cents';
import { DomainError } from '../shared/DomainError';
import type { Channel } from '../rules/channels.rules';
import {
  AMEX_HOTEL_CREDIT_FACE_CENTS,
  CSR_EDIT_CREDIT_FACE_CENTS,
  CREDIT_MIN_NIGHTS_RULE,
} from '../rules/credit.rules';

export interface CreditFaceInput {
  readonly channel: Channel;
  readonly prepaid: boolean;
  readonly nights: number;
  readonly amexBucketAvailable: boolean;
  readonly editBucketAvailable: boolean;
}

/**
 * `creditFaceFor` — §3.3 step 8.
 *
 * > FHR prepaid + amex bucket → 30000. THC prepaid + amex bucket + nights ≥ 2 →
 * > 30000. EDIT prepaid + edit bucket + nights ≥ 2 → 25000. Otherwise 0.
 *
 * Every figure here comes from `../rules/`. No literal amounts, per §2.8.
 *
 * Note this returns the credit's **face**, not what the user keeps. The refund
 * is subtracted from the charge first (step 9), and only then is the face capped
 * against what remains (step 10). Reversing that order is the bug fixture TC-05
 * is built to catch.
 */
export function creditFaceFor(input: CreditFaceInput): Cents {
  const { channel, prepaid, nights, amexBucketAvailable, editBucketAvailable } = input;
  const minNights = CREDIT_MIN_NIGHTS_RULE.value;

  if (!prepaid) return ZERO_CENTS;

  switch (channel) {
    case 'FHR':
      // Fine Hotels + Resorts has no night minimum.
      return amexBucketAvailable ? AMEX_HOTEL_CREDIT_FACE_CENTS : ZERO_CENTS;

    case 'THC':
      return amexBucketAvailable && nights >= minNights
        ? AMEX_HOTEL_CREDIT_FACE_CENTS
        : ZERO_CENTS;

    case 'EDIT':
      return editBucketAvailable && nights >= minNights ? CSR_EDIT_CREDIT_FACE_CENTS : ZERO_CENTS;

    // Every other channel unlocks no portal statement credit. `CHASE_TRAVEL`'s
    // select-brands credit is property-dependent and is applied from the live
    // bucket state at booking time, not inferred in the pure engine.
    case 'CHASE_TRAVEL':
    case 'DIRECT_FLEX':
    case 'DIRECT_PREPAID':
    case 'OTA':
    case 'FORA':
    case 'PHONE':
      return ZERO_CENTS;

    default:
      // Unreachable while `channel` is a `Channel`. Kept as a loud failure
      // rather than a silent `return 0`, because a channel added to the union
      // without a decision here would otherwise quietly forfeit a credit.
      throw new DomainError(
        'UNKNOWN_CHANNEL',
        `No statement-credit rule defined for channel "${String(channel)}".`,
        { channel },
      );
  }
}

/**
 * Whether a channel *would* have unlocked a credit but for the night minimum.
 * Drives the `EDIT_UNDER_TWO_NIGHTS` warning without duplicating the table.
 */
export function missesNightMinimum(channel: Channel, nights: number): boolean {
  return (channel === 'EDIT' || channel === 'THC') && nights < CREDIT_MIN_NIGHTS_RULE.value;
}
