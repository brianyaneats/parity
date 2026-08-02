'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

/**
 * The global shell — §7.2.
 *
 * "Left sidebar, 220px, collapsible to a 56px icon rail below 1024px, becoming
 * a bottom tab bar below 640px. No top bar, no search bar, no notification bell
 * — the badges carry it."
 *
 * The badge rules are specific and they are the whole navigation design: Claims
 * badges when a claim is within 24 hours, Credits badges when a bucket expires
 * within 30 days. Those are the two things that cost real money if ignored, so
 * they are the only two things allowed to interrupt.
 */

export interface NavBadges {
  /** Claims due within 24 hours. */
  readonly claims?: number;
  /** Buckets expiring within 30 days with money left. */
  readonly credits?: number;
}

interface NavItem {
  readonly href: string;
  readonly label: string;
  /** Two-character rail glyph. Text, not an icon font — §0.5 bans decoration. */
  readonly rail: string;
  readonly badgeKey?: keyof NavBadges;
}

const NAV_ITEMS: readonly NavItem[] = Object.freeze([
  { href: '/compare', label: 'Compare', rail: 'Cp' },
  { href: '/claims', label: 'Claims', rail: 'Cl', badgeKey: 'claims' },
  { href: '/credits', label: 'Credits', rail: 'Cr', badgeKey: 'credits' },
  { href: '/trips', label: 'Trips', rail: 'Tr' },
  { href: '/watchlist', label: 'Watchlist', rail: 'Wl' },
  { href: '/ledger', label: 'Ledger', rail: 'Ld' },
  { href: '/properties', label: 'Properties', rail: 'Pr' },
]);

export function AppShell({
  children,
  badges = {},
}: {
  children: React.ReactNode;
  badges?: NavBadges;
}) {
  return (
    <div className="min-h-dvh bg-canvas">
      <Sidebar badges={badges} />
      {/* Bottom padding below 640px clears the tab bar; left padding above
          1024px clears the sidebar. */}
      <main
        id="main"
        className="pb-20 pl-0 sm:pb-0 sm:pl-rail lg:pl-sidebar"
        tabIndex={-1}
      >
        {children}
      </main>
    </div>
  );
}

function Sidebar({ badges }: { badges: NavBadges }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        // Below 640px: a bottom tab bar. Above: a fixed left rail that widens
        // to the full sidebar at 1024px.
        'fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface-1',
        'sm:inset-y-0 sm:right-auto sm:w-rail sm:flex-col sm:border-r sm:border-t-0',
        'lg:w-sidebar',
      )}
    >
      <div className="hidden px-4 py-4 lg:block">
        <span className="text-h2 text-text-primary">Parity</span>
      </div>

      <ul className="flex flex-1 justify-around sm:flex-col sm:justify-start sm:gap-0.5 sm:px-2 sm:py-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const badge = item.badgeKey ? badges[item.badgeKey] : undefined;

          return (
            <li key={item.href} className="flex-1 sm:flex-none">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center gap-0.5 rounded-md px-2 py-2 text-xs',
                  'sm:flex-row sm:gap-3 sm:text-sm',
                  'transition-colors duration-fast ease-standard',
                  active
                    ? 'bg-glass text-text-primary'
                    : 'text-text-secondary hover:bg-glass-hover hover:text-text-primary',
                )}
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-xs text-text-muted lg:hidden"
                >
                  {item.rail}
                </span>
                <span className="hidden lg:inline">{item.label}</span>
                <span className="sm:hidden">{item.label}</span>

                {badge !== undefined && badge > 0 ? (
                  <>
                    {/* §6.7: the count is the meaning, not the colour. The
                        screen-reader text spells out what it counts. */}
                    <span
                      aria-hidden="true"
                      className="tnum ml-auto rounded-pill bg-status-critical px-1.5 text-label text-status-ink"
                    >
                      {badge}
                    </span>
                    <span className="sr-only">
                      {item.badgeKey === 'claims'
                        ? `, ${badge} claim${badge === 1 ? '' : 's'} due within 24 hours`
                        : `, ${badge} credit${badge === 1 ? '' : 's'} expiring within 30 days`}
                    </span>
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Settings pinned to the bottom — §7.2. Hidden in the mobile tab bar,
          where seven items is already the limit of what fits legibly. */}
      <div className="hidden border-t border-border px-2 py-3 sm:block">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 rounded-md px-2 py-2 text-sm',
            'transition-colors duration-fast ease-standard',
            pathname.startsWith('/settings')
              ? 'bg-glass text-text-primary'
              : 'text-text-secondary hover:bg-glass-hover hover:text-text-primary',
          )}
        >
          <span aria-hidden="true" className="font-mono text-xs text-text-muted lg:hidden">
            St
          </span>
          <span className="hidden lg:inline">Settings</span>
        </Link>
        <div className="mt-2 hidden lg:block">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
