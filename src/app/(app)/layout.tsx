import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { AppShell } from '@/components/layout/AppShell';
import { ToastProvider } from '@/components/ui';

/**
 * The authenticated shell — §7.2, §5.1 ("auth on every route except
 * `/api/health`").
 *
 * The session check here is the shell's own gate, layered under
 * `middleware.ts`'s cookie-presence redirect and over each page's required
 * `userId` query parameter. Three layers on purpose: middleware can be
 * bypassed by a matcher gap, a layout does not re-render on soft navigation
 * between sibling pages, and a page can forget — but all three failing at
 * once is a different class of accident than any one of them being the sole
 * guard. The queries' required `userId` is the layer that actually cannot be
 * skipped.
 *
 * Badge counts are computed server-side so the sidebar is correct on first
 * paint rather than popping in after a client fetch. §7.2 makes the badges the
 * entire notification surface ("no top bar, no search bar, no notification bell
 * — the badges carry it"), which only works if they are right immediately.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const badges = await loadBadges(session.userId);

  return (
    <ToastProvider>
      <AppShell badges={badges}>{children}</AppShell>
    </ToastProvider>
  );
}

async function loadBadges(userId: string): Promise<{ claims: number; credits: number }> {
  // Reads are deliberately resilient: a database blip should degrade the badge
  // to zero, not blank the whole application shell.
  try {
    const { countUrgentBadges } = await import('@/infrastructure/persistence/queries/badges');
    return await countUrgentBadges(userId);
  } catch {
    return { claims: 0, credits: 0 };
  }
}
