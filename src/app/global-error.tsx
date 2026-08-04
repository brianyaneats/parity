'use client';

import * as React from 'react';
import '@/styles/globals.css';
import { Button, Card } from '@/components/ui';

export interface GlobalErrorPageProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

/**
 * Catches a throw from the root layout itself — the one place `error.tsx`
 * cannot reach, per Next's convention. Because it replaces the root layout
 * entirely while active, it has to supply its own `<html>`/`<body>` and its
 * own copy of `globals.css`; there is no parent layout left standing to
 * provide either.
 *
 * Deliberately minimal: no theme-cookie read (this is a client component
 * with no server parent to hand it one via `cookies()`) and no `next/font`
 * load — both are exactly the kind of extra machinery a last-resort crash
 * page should avoid pulling in. It renders in `tokens.css`'s bare `:root`
 * (dark) with the system sans-serif fallback from `--font-ui`; correct, just
 * not preference-matched.
 */
export default function GlobalError({ error, reset }: GlobalErrorPageProps) {
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-canvas text-text-primary font-ui antialiased">
        <main className="flex min-h-dvh items-center justify-center p-4">
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
      </body>
    </html>
  );
}
