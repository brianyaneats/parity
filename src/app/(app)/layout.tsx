import { AppShell } from '@/components/layout/AppShell';
import { ToastProvider } from '@/components/ui';

/**
 * The authenticated shell — §7.2.
 *
 * Badge counts are computed server-side so the sidebar is correct on first
 * paint rather than popping in after a client fetch. §7.2 makes the badges the
 * entire notification surface ("no top bar, no search bar, no notification bell
 * — the badges carry it"), which only works if they are right immediately.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const badges = await loadBadges();

  return (
    <ToastProvider>
      <AppShell badges={badges}>{children}</AppShell>
    </ToastProvider>
  );
}

async function loadBadges(): Promise<{ claims: number; credits: number }> {
  // Reads are deliberately resilient: a database blip should degrade the badge
  // to zero, not blank the whole application shell.
  try {
    const { countUrgentBadges } = await import('@/infrastructure/persistence/queries/badges');
    return await countUrgentBadges();
  } catch {
    return { claims: 0, credits: 0 };
  }
}
