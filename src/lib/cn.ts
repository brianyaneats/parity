import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names with Tailwind conflict resolution.
 *
 * `twMerge` matters here beyond convenience: variant components compose class
 * strings, and without it a caller's `px-4` silently loses to a base `px-3`
 * depending on stylesheet order rather than on intent.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
