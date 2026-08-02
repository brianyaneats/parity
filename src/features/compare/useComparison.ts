'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SavingsEngine } from '@/domain/engine/SavingsEngine';
import type { ChannelQuote, ComparisonResult, StayContext } from '@/domain/engine/types';
import type { CompareChannelsOutput } from '@/application/usecases/CompareChannelsUseCase';
import type { BucketAvailabilitySnapshot } from '@/domain/credit/CreditBucketResolution';

/**
 * The comparator's data flow — §5.3 and §7.3.
 *
 * §5.3 is explicit about the contract: "The client may compute optimistically
 * for instant feedback, but the server response is authoritative and the UI
 * must reconcile to it. Do not fork the math into two implementations; import
 * one module in both places."
 *
 * So this hook imports the same `SavingsEngine` the API route uses. The local
 * result is not an approximation — it is the identical computation, which is
 * what makes optimistic rendering safe rather than a source of flicker between
 * two slightly different numbers.
 *
 * §7.3's acceptance criteria drive the rest: results update within 250 ms of the
 * last keystroke, and there is no layout shift during recompute — which is why
 * `result` keeps the previous value while `status` is `'computing'` rather than
 * being cleared to null.
 */

const DEBOUNCE_MS = 250;

/** Sensitivity bisects over many evaluations; skip it on the per-keystroke path. */
const localEngine = new SavingsEngine({ includeSensitivity: false });

export type ComparisonStatus = 'idle' | 'computing' | 'settled' | 'error';

export interface UseComparisonResult {
  readonly result: ComparisonResult | null;
  /**
   * §5.3 / task item 3: the server's own read of live bucket state — never the
   * client's optimistic guess. `null` until the first authoritative response
   * lands; stays at its last known value across later *optimistic* passes
   * (bucket state does not change keystroke to keystroke) so the "spent"
   * messaging in `CompareScreen` does not flicker on every debounce.
   */
  readonly bucketAvailability: BucketAvailabilitySnapshot | null;
  readonly status: ComparisonStatus;
  readonly error: string | null;
  /** True while the displayed result came from the client, not the server. */
  readonly optimistic: boolean;
  retry(): void;
}

export function useComparison(
  context: StayContext,
  quotes: readonly ChannelQuote[],
): UseComparisonResult {
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [bucketAvailability, setBucketAvailability] = useState<BucketAvailabilitySnapshot | null>(
    null,
  );
  const [status, setStatus] = useState<ComparisonStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Guards against an out-of-order response overwriting a newer one — the user
  // types faster than the network answers.
  const generation = useRef(0);

  const payload = useMemo(() => ({ context, quotes: [...quotes] }), [context, quotes]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (payload.quotes.length === 0) {
      setResult(null);
      setBucketAvailability(null);
      setStatus('idle');
      setError(null);
      return undefined;
    }

    const current = (generation.current += 1);

    // Optimistic pass: same engine, same numbers, no network. This is what
    // makes the screen feel instant while the authoritative call is in flight.
    try {
      setResult(localEngine.compare(payload));
      setOptimistic(true);
      setError(null);
    } catch {
      // A locally-invalid input (nights < 1) throws; the server returns a
      // structured validation error, so let that be what reports it.
    }
    setStatus('computing');

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch('/api/compare', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (generation.current !== current) return;

          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as
              | { error?: { message?: string } }
              | null;
            setStatus('error');
            setError(body?.error?.message ?? 'Could not compute this comparison.');
            return;
          }

          const authoritative = (await response.json()) as CompareChannelsOutput;
          if (generation.current !== current) return;

          // Reconcile to the server. §5.3: its answer is the one that counts.
          // `bucketAvailability` is split out into its own piece of state
          // (rather than left on `result`) so an *optimistic* pass in between
          // two authoritative responses does not have to fabricate a value
          // for it — see the field's own doc comment above.
          const { bucketAvailability: serverBucketAvailability, ...comparisonResult } = authoritative;
          setResult(comparisonResult);
          setBucketAvailability(serverBucketAvailability);
          setOptimistic(false);
          setStatus('settled');
          setError(null);
        } catch (caught) {
          if (controller.signal.aborted || generation.current !== current) return;
          setStatus('error');
          setError(caught instanceof Error ? caught.message : 'Could not reach the server.');
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [payload, attempt]);

  return { result, bucketAvailability, status, error, optimistic, retry };
}
