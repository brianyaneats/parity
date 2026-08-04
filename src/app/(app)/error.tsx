'use client';

import * as React from 'react';
import { Button, Card } from '@/components/ui';

export interface ErrorPageProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

/**
 * `(app)` segment error boundary — catches a throw from any page under the
 * app shell (`/compare`, `/claims`, etc.) while `AppLayout`'s `AppShell`
 * stays mounted above it (Next's per-segment `error.tsx` only replaces the
 * segment's own content, not the parent layout), so the sidebar is still
 * there to navigate away with.
 *
 * Not `ErrorBoundary` (`src/components/ui/ErrorBoundary.tsx`): that
 * component wraps a `children` subtree in its own class-component boundary
 * for errors inside content it renders. This file *is* the boundary Next
 * already built for the segment — it receives `error`/`reset` directly and
 * has no children to wrap, so `ErrorBoundary` doesn't fit here.
 */
export default function AppSegmentError({ error, reset }: ErrorPageProps) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[(app)/error]', error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 lg:p-6">
      <Card role="alert" className="flex flex-col items-start gap-3">
        <h1 className="text-h2 text-text-primary">Something went wrong</h1>
        <p className="text-sm text-text-secondary">{error.message || 'An unexpected error occurred.'}</p>
        {error.digest ? (
          <p className="text-xs text-text-muted">
            Reference: <span className="tnum">{error.digest}</span>
          </p>
        ) : null}
        <Button variant="secondary" size="sm" onClick={reset}>
          Try again
        </Button>
      </Card>
    </div>
  );
}
