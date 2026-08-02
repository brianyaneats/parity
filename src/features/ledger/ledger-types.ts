import type { SavingsEventKind } from './ledger-aggregate';

/**
 * The ledger's UI-facing event shape — the join of `savings_events` with just
 * enough of `bookings`/`comparisons` to make §7.7's "every event is drillable
 * to its booking and its comparison snapshot" true.
 *
 * Defined here (feature-owned) and imported by the persistence query layer,
 * mirroring how `PropertyOption` is owned by `CompareScreen.tsx` and imported
 * by `queries/properties.ts` — the feature that renders a shape owns its
 * type; the query module conforms to it rather than the other way round.
 */
export interface LedgerEventView {
  readonly id: string;
  readonly kind: SavingsEventKind;
  readonly amountCents: number;
  readonly realized: boolean;
  /** ISO `YYYY-MM-DD`. */
  readonly occurredOn: string;
  readonly note: string | null;
  /** `null` when the event isn't tied to a booking — e.g. a manually logged
   * credit burn. Nothing to drill into in that case. */
  readonly bookingId: string | null;
  readonly claimId: string | null;
  /** The booking's originating comparison, if any — the target of "its
   * comparison snapshot" (§4.3's immutable `result_snapshot`). */
  readonly comparisonId: string | null;
  readonly propertyLabel: string | null;
  readonly channel: string | null;
}
