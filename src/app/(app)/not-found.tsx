import Link from 'next/link';
import { EmptyState } from '@/components/ui';

export const metadata = { title: 'Not found · Parity' };

/**
 * `(app)` segment not-found — renders for any unmatched route under the app
 * shell, and for any page that calls `notFound()` explicitly. `claims/[id]`,
 * `trips/[id]`, and `compare/[id]` all do that for a record that either
 * doesn't exist or doesn't belong to the signed-in user — deliberately the
 * same outcome for both. Confirming "that ID exists, it's just not yours"
 * would leak account-to-account information a 404 exists to avoid leaking,
 * so the copy stays neutral between "doesn't exist" and "isn't yours."
 *
 * A plain `<Link>` rather than `EmptyState`'s own `action` slot: this is a
 * server component, so there is no client boundary for an `onClick` to live
 * in — same reasoning `claims/[id]/page.tsx` already uses for its own
 * not-found case.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 lg:p-6">
      <EmptyState message="This page doesn't exist, or it isn't yours to see." />
      <Link
        href="/compare"
        className="self-center text-sm text-text-secondary underline-offset-2 hover:underline"
      >
        Back to compare
      </Link>
    </div>
  );
}
