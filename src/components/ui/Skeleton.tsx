import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Skeleton — a loading placeholder block. `animate-pulse` is Tailwind's
 * built-in opacity keyframe (1 → .5 → 1), so it stays within §6.6's
 * opacity/transform/width-only transition rule without any custom CSS.
 */
export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-2', className)}
      {...props}
    />
  );
}
