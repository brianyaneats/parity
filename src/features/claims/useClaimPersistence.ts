'use client';

import { useCallback, useState } from 'react';
import type { Claim } from '@/domain/claim/Claim';
import type { ClaimStatus } from '@/domain/claim/ClaimStatus';
import type { DenialCode } from '@/domain/claim/DenialReason';
import type { Cents } from '@/domain/shared/cents';

/**
 * Persisting claim actions — the fix for the worst defect in the product.
 *
 * Before this, `ClaimKit` mutated a client-side `Claim` object and re-rendered.
 * Nothing reached the server. A user could tick all ten evidence items, copy the
 * claim text, file it with Chase, press "Mark submitted", see a success toast —
 * and the row in the database never left `ELIGIBLE`. The `claim-deadline-sweep`
 * cron would then auto-expire it at T+24h, and the sidebar badge would keep
 * nagging about a claim they had already filed.
 *
 * That is worse than not having the button. §1.5's second success criterion is
 * "no price-match claim window is ever missed", and the app itself was
 * manufacturing the false confidence that causes the miss.
 *
 * **Order of operations matters here.** The server is authoritative for a
 * persisted state machine, so:
 *
 *   1. the caller pre-checks locally (instant feedback on an illegal move, and
 *      no pointless round trip),
 *   2. the server transitions and persists — it re-validates through the same
 *      `Claim` aggregate, so its answer is the real one,
 *   3. only on success does the local aggregate advance to match.
 *
 * Applying the local mutation first and rolling back on failure would be
 * simpler and wrong: `transitionTo` mutates in place, and a half-applied
 * rollback on a state machine is how a UI ends up showing a status the
 * database disagrees with.
 */

export type ClaimActionState = 'idle' | 'saving' | 'error';

export interface TransitionDetails {
  readonly awardedCents?: Cents;
  readonly denialReason?: string;
  readonly denialCode?: DenialCode;
  readonly notes?: string;
}

export interface UseClaimPersistenceResult {
  readonly state: ClaimActionState;
  readonly error: string | null;
  /**
   * Persists a transition, then syncs the local aggregate. Resolves true only
   * when the row actually changed in the database.
   */
  transition(claim: Claim, next: ClaimStatus, details?: TransitionDetails): Promise<boolean>;
  /** Records a screenshot against the claim's competing rate — §5.2, §12. */
  uploadEvidence(claimId: string, file: File): Promise<boolean>;
  clearError(): void;
}

export function useClaimPersistence(): UseClaimPersistenceResult {
  const [state, setState] = useState<ClaimActionState>('idle');
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const transition = useCallback(
    async (claim: Claim, next: ClaimStatus, details: TransitionDetails = {}): Promise<boolean> => {
      setState('saving');
      setError(null);

      try {
        const response = await fetch(`/api/claims/${claim.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status: next,
            ...(details.awardedCents !== undefined ? { awardedCents: details.awardedCents } : {}),
            ...(details.denialReason ? { denialReason: details.denialReason } : {}),
            ...(details.denialCode ? { denialCode: details.denialCode } : {}),
            ...(details.notes ? { notes: details.notes } : {}),
          }),
        });

        if (!response.ok) {
          setState('error');
          setError(await messageFrom(response, 'Could not save this change.'));
          return false;
        }

        // The server agreed and the row moved. Advance the local aggregate so
        // the screen matches what is now stored, rather than re-fetching the
        // whole kit for a state change we already know the shape of.
        claim.transitionTo(next, new Date(), {
          awardedCents: details.awardedCents ?? null,
          denialReason: details.denialReason ?? null,
          denialCode: details.denialCode ?? null,
          notes: details.notes ?? null,
        });

        setState('idle');
        return true;
      } catch {
        setState('error');
        setError('Could not reach the server. Nothing was saved.');
        return false;
      }
    },
    [],
  );

  const uploadEvidence = useCallback(async (claimId: string, file: File): Promise<boolean> => {
    setState('saving');
    setError(null);

    try {
      // §12: screenshots go to private object storage behind a short-lived
      // signed URL. The server issues the URL; the bytes never pass through
      // the application server, so no copy of a page that may contain the
      // user's name and itinerary lingers in a request log.
      const signResponse = await fetch(`/api/claims/${claimId}/evidence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, fileSizeBytes: file.size }),
      });

      if (!signResponse.ok) {
        setState('error');
        setError(await messageFrom(signResponse, 'Could not prepare the upload.'));
        return false;
      }

      const { uploadUrl } = (await signResponse.json()) as { uploadUrl?: string };

      if (uploadUrl) {
        const put = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': file.type },
          body: file,
        });
        if (!put.ok) {
          setState('error');
          setError('The screenshot could not be uploaded. The claim is otherwise saved.');
          return false;
        }
      }

      setState('idle');
      return true;
    } catch {
      setState('error');
      setError('Could not reach the server. The screenshot was not uploaded.');
      return false;
    }
  }, []);

  return { state, error, transition, uploadEvidence, clearError };
}

/**
 * Prefers the server's own message. §5.1's envelope carries a human-readable
 * one, and it is the only text that can say *why* a transition was refused —
 * "an expired claim can only move to EXPIRED or NOT_PURSUED" is far more use
 * than "something went wrong".
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
