'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui';
import { FOCUS_RING } from '@/components/ui/_shared';

/**
 * `POST /api/auth/logout` behind a single hook, shared by the sidebar footer
 * button below and `CommandPalette`'s own "Sign out" item — one fetch call,
 * one place that decides what a failure looks like, instead of two copies
 * drifting apart.
 *
 * Errors go to the toast queue rather than local component state: the
 * palette closes itself the moment a command is selected (§ its own doc
 * comment), so an inline error message rendered inside the (now-unmounted)
 * palette would never be seen. The toast is the one feedback surface that
 * outlives whichever control triggered this. `AppShell` is always rendered
 * under `ToastProvider` (see `(app)/layout.tsx`), so `useToast` here is safe.
 */
export function useSignOut(): { readonly signOut: () => void; readonly pending: boolean } {
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  const signOut = React.useCallback(() => {
    if (pending) return;
    setPending(true);
    void (async () => {
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        if (!response.ok) {
          toast({ title: 'Could not sign out', description: 'Try again.', variant: 'error' });
          setPending(false);
          return;
        }
        // Hard navigation, not router.push: the session cookie the server
        // reads on every request just changed, and no cached RSC payload
        // downstream of it can be trusted after that.
        window.location.assign('/login');
      } catch {
        toast({ title: 'Could not reach the server', description: 'Nothing changed.', variant: 'error' });
        setPending(false);
      }
    })();
  }, [pending, toast]);

  return { signOut, pending };
}

/**
 * The sidebar-footer sign-out control — same glyph-then-label responsive
 * pattern as the nav links above it (rail glyph below `lg`, text at `lg`+),
 * but a `<button>` rather than a `Link` since it performs an action, not a
 * navigation.
 *
 * `aria-label` is explicit rather than left to the visible children: at the
 * icon-rail tier (sm–lg) the text label is `hidden` and the glyph is
 * `aria-hidden`, which would otherwise leave the button with no accessible
 * name in that width range.
 */
export function SignOutButton({ className }: { readonly className?: string }) {
  const { signOut, pending } = useSignOut();

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      aria-label="Sign out"
      aria-busy={pending || undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-text-secondary',
        'transition-colors duration-fast ease-standard hover:bg-glass-hover hover:text-text-primary',
        'disabled:pointer-events-none disabled:opacity-50',
        FOCUS_RING,
        className,
      )}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-text-muted" />
      ) : (
        <span aria-hidden="true" className="font-mono text-xs text-text-muted lg:hidden">
          SO
        </span>
      )}
      <span aria-hidden="true" className="hidden lg:inline">
        {pending ? 'Signing out…' : 'Sign out'}
      </span>
    </button>
  );
}
