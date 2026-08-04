import { Skeleton } from '@/components/ui';

/**
 * `(app)` segment loading UI — Next's automatic Suspense fallback while a
 * page in this segment streams in. Deliberately generic: the segment holds
 * half a dozen differently-shaped screens (a table, a form, a detail view)
 * and none of them is common enough to justify a per-screen mimic, so this
 * is a coarse title-plus-rows skeleton rather than one.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 lg:p-6" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-1 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
