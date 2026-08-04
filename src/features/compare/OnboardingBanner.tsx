'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@/components/ui';
import { createSampleComparison, dismissOnboarding } from './onboardingActions';

/**
 * `/compare`'s first-run welcome — rendered by `CompareScreen` only when the
 * server page determined the caller has zero saved comparisons and has not
 * already dismissed this (`src/app/(app)/compare/page.tsx`'s `showOnboarding`
 * prop). A Card, not a modal: the task brief this ships under is explicit
 * that this build never uses one, and a first-run message blocking the very
 * form it is explaining would undercut its own "60 seconds" pitch.
 *
 * Two actions, both server actions in `./onboardingActions`:
 *  - "Load a sample comparison" creates one real `DRAFT` row for the caller
 *    and navigates to it, the fastest way to see what a *finished* comparison
 *    looks like before typing a single quote.
 *  - Dismiss sets the `onboarding-dismissed` cookie so this does not return
 *    once the point has been made, independent of whether the caller goes on
 *    to save anything.
 *
 * Hides itself optimistically on either action — the load path navigates
 * away entirely, and dismiss does not wait on `router.refresh()`'s round
 * trip to stop showing something the caller just asked to be rid of.
 */
export function OnboardingBanner() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [loadingSample, startLoadingSample] = useTransition();
  const [dismissing, startDismissing] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (dismissed) return null;

  const handleLoadSample = () => {
    setError(null);
    startLoadingSample(async () => {
      const result = await createSampleComparison();
      if (result.ok) {
        router.push(`/compare/${result.comparisonId}`);
      } else {
        setError(result.message);
      }
    });
  };

  const handleDismiss = () => {
    setDismissed(true);
    startDismissing(async () => {
      await dismissOnboarding();
      router.refresh();
    });
  };

  return (
    <Card className="flex flex-col gap-3 border-border-strong bg-surface-2">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-h3 text-text-primary">New here? The loop takes about 60 seconds.</h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={dismissing}
          onClick={handleDismiss}
          aria-label="Dismiss the welcome banner"
        >
          Dismiss
        </Button>
      </div>
      <p className="text-sm text-text-secondary">
        Enter two quotes for the same stay, and the ranking on the right shows the effective net
        cost after every perk, statement credit and point — not just the sticker price. Save it and
        it is on your ledger for good.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" loading={loadingSample} onClick={handleLoadSample}>
          Load a sample comparison
        </Button>
        {error ? (
          <p role="alert" className="text-xs text-status-critical">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
