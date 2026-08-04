'use client';

import { useCallback, useState } from 'react';
import type { ChannelQuote, ChannelResult, StayContext } from '@/domain/engine/types';
import type { PaymentRoute } from '@/domain/rules/posting.rules';

/**
 * Persisting a comparison, and recording a booking against it — §5.2, §7.3.
 *
 * §7.3's actions row is "Save comparison · Mark as booked (opens the booking
 * recorder) · Export". The first two write, so they need dates: §4.2 makes
 * `check_in` and `check_out` NOT NULL, which is why the screen collects a date
 * range rather than a bare night count.
 *
 * "Mark as booked" saves first when the comparison is unsaved, so the booking
 * always links back to the snapshot it was decided from. §1.5's first success
 * criterion — "the user's ranked #1 channel is the one they actually book, at
 * least 80% of the time" — is only measurable if that link exists.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface CompetingRateInput {
  readonly siteDomain: string;
  readonly url: string;
  readonly baseCents: number;
  readonly refundable: boolean;
  readonly publiclyAvailable: boolean;
}

export interface SaveInput {
  readonly propertyId: string | null;
  readonly propertyName: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly context: StayContext;
  readonly quotes: readonly ChannelQuote[];
  /**
   * Carried through so the claim kit has something to generate text from
   * (§7.4 item 4) and so PM8's parameter match can name its source. Null when
   * the user entered a rate but not where it came from.
   */
  readonly competingRate?: CompetingRateInput | null;
}

export interface UseSaveComparisonResult {
  readonly state: SaveState;
  readonly error: string | null;
  /** Id of the persisted comparison, once there is one. */
  readonly comparisonId: string | null;
  save(input: SaveInput): Promise<string | null>;
  markAsBooked(input: SaveInput, winner: ChannelResult, paymentRoute?: PaymentRoute): Promise<boolean>;
  reset(): void;
}

/** §4.2 requires both dates; the UI must not let a save fail on a missing one. */
export function canPersist(checkIn: string, checkOut: string): boolean {
  return checkIn.length > 0 && checkOut.length > 0 && checkOut > checkIn;
}

export function useSaveComparison(): UseSaveComparisonResult {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [comparisonId, setComparisonId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
  }, []);

  const save = useCallback(async (input: SaveInput): Promise<string | null> => {
    if (!canPersist(input.checkIn, input.checkOut)) {
      setState('error');
      setError('Add check-in and check-out dates before saving.');
      return null;
    }

    setState('saving');
    setError(null);

    try {
      const response = await fetch('/api/comparisons', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId: input.propertyId,
          propertyNameSnapshot: input.propertyName,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          context: input.context,
          quotes: input.quotes,
          ...(input.competingRate ? { competingRate: input.competingRate } : {}),
        }),
      });

      if (!response.ok) {
        setState('error');
        setError(await messageFrom(response, 'Could not save this comparison.'));
        return null;
      }

      const saved = (await response.json()) as { id?: string };
      setComparisonId(saved.id ?? null);
      setState('saved');
      return saved.id ?? null;
    } catch {
      setState('error');
      setError('Could not reach the server. Nothing was saved.');
      return null;
    }
  }, []);

  const markAsBooked = useCallback(
    async (input: SaveInput, winner: ChannelResult, paymentRoute?: PaymentRoute): Promise<boolean> => {
      // Save first when unsaved, so the booking links to the snapshot it was
      // decided from rather than floating free of it.
      const id = comparisonId ?? (await save(input));
      if (!id) return false;

      setState('saving');
      try {
        const response = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            comparisonId: id,
            channel: winner.channel,
            bookedAt: new Date().toISOString(),
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            totalCents: winner.totalCents,
            baseCents: winner.baseCents,
            prepaid: winner.prepaid,
            refundable: winner.refundable,
            // Distinct from `prepaid`, which is the rate type. This is who
            // actually took the money — see `posting.rules.ts`.
            ...(paymentRoute ? { paymentRoute } : {}),
          }),
        });

        if (!response.ok) {
          setState('error');
          setError(await messageFrom(response, 'Could not record this booking.'));
          return false;
        }

        setState('saved');
        return true;
      } catch {
        setState('error');
        setError('Could not reach the server. The booking was not recorded.');
        return false;
      }
    },
    [comparisonId, save],
  );

  return { state, error, comparisonId, save, markAsBooked, reset };
}

/**
 * Prefers the server's own message. §5.1's envelope carries a human-readable
 * one plus per-field detail, and a generic client-side string would throw away
 * the only text that says *which* field is wrong.
 */
async function messageFrom(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string; fields?: Record<string, string> } }
    | null;

  const fields = body?.error?.fields;
  if (fields) {
    const first = Object.entries(fields)[0];
    if (first) return `${first[0]} ${first[1]}`;
  }
  return body?.error?.message ?? fallback;
}
