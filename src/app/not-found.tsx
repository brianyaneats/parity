import Link from 'next/link';
import { EmptyState } from '@/components/ui';

export const metadata = { title: 'Not found · Parity' };

/**
 * Top-level not-found — the fallback for any request that misses every
 * route, including outside the `(app)` segment. Renders inside the root
 * layout only, with no `AppShell` around it, so it uses the same
 * full-screen centered frame as `/login` rather than a padded content
 * column that assumes a sidebar is there.
 */
export default function RootNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas p-4">
      <EmptyState message="This page doesn't exist." className="w-full max-w-sm" />
      <Link href="/" className="text-sm text-text-secondary underline-offset-2 hover:underline">
        Go home
      </Link>
    </main>
  );
}
