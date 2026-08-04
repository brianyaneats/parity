'use client';

import * as React from 'react';
import { Button, Card } from '@/components/ui';

export interface ErrorPageProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

/**
 * Root error boundary (Next's `error.tsx` convention). Next hands a throw to
 * the nearest boundary, so in practice `(app)/error.tsx` catches everything
 * under the app shell and this one only fires for `/login`, `/`, or anything
 * else that renders directly under the root layout.
 *
 * Rendered inside the root layout's `<html>`/`<body>` — unlike
 * `global-error.tsx`, which replaces the root layout itself and has to
 * supply those tags on its own.
 */
export default function RootError({ error, reset }: ErrorPageProps) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[app/error]', error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <Card className="flex w-full max-w-sm flex-col items-start gap-3">
        <h1 className="text-h2 text-text-primary">Something went wrong</h1>
        <p className="text-sm text-text-secondary">{error.message || 'An unexpected error occurred.'}</p>
        {error.digest ? (
          <p className="text-xs text-text-muted">
            Reference: <span className="tnum">{error.digest}</span>
          </p>
        ) : null}
        <Button variant="primary" size="sm" onClick={reset}>
          Try again
        </Button>
      </Card>
    </main>
  );
}
