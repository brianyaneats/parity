import { notFound } from 'next/navigation';
import { SavedComparison } from '@/features/compare/SavedComparison';
import { ENGINE_VERSION } from '@/domain/engine/version';
import { EmptyState } from '@/components/ui';

export const metadata = { title: 'Saved comparison · Parity' };

/**
 * `/compare/[id]` — §7.1: "a saved comparison, read-only until 'recompute'".
 *
 * The page loads the stored snapshot and hands it straight to the view. It does
 * not call the engine, because §4.3 forbids recomputing a historical record on
 * read and §13.3 warns that doing so is the instinctive mistake.
 */
export default async function SavedComparisonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const comparison = await loadComparison(id);

  if (comparison === 'unavailable') {
    return (
      <div className="mx-auto w-full max-w-[900px] p-6">
        <EmptyState message="Saved comparisons need a database. Run pnpm db:migrate and pnpm db:seed, then reload." />
      </div>
    );
  }

  if (!comparison) notFound();

  return <SavedComparison {...comparison} currentEngineVersion={ENGINE_VERSION} />;
}

type LoadResult = Omit<
  React.ComponentProps<typeof SavedComparison>,
  'currentEngineVersion'
> | null | 'unavailable';

async function loadComparison(id: string): Promise<LoadResult> {
  try {
    const { findComparisonById } = await import(
      '@/infrastructure/persistence/queries/comparisons'
    );
    return await findComparisonById(id);
  } catch {
    // Distinguished from "not found" deliberately: a missing database is a
    // setup problem the user can fix, and a 404 would send them looking for the
    // wrong thing.
    return 'unavailable';
  }
}
