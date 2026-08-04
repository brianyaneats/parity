'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { CommandPalette } from './CommandPalette';
import { SignOutButton } from './SignOutButton';
import { NAV_ITEMS, SETTINGS_NAV_ITEM, type NavBadges, type NavItem } from './nav-items';

export type { NavBadges, NavItem } from './nav-items';

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
 *
 * Two more pieces of chrome live here beyond the primary nav: a sign-out
 * control pinned to the sidebar footer (`SignOutButton`, `./nav-items` for
 * why Settings — its neighbour there — is a separate constant rather than an
 * eighth `NAV_ITEMS` entry), and a global command palette (`CommandPalette`)
 * mounted once here so ⌘K/Ctrl+K works from anywhere in the app.
 */

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
      <CommandPalette />
    </div>
  );
}

/**
 * A nav entry's link, shared by the primary list below and the mobile-only
 * Settings duplicate — same three-tier responsive treatment (stacked
 * glyph+label below `sm`, glyph-only rail `sm`–`lg`, label-only at `lg`+) and
 * the same badge rendering, so the two call sites can't drift apart.
 */
function NavLink({
  item,
  active,
  badge,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
}) {
  return (
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
      <item.icon aria-hidden="true" strokeWidth={1.75} className="h-5 w-5 shrink-0 lg:hidden" />
      {/* One label at every tier: visible below `sm` (under the icon) and at
          `lg`+ (beside it), screen-reader-only on the sm–lg icon rail — which
          is what gives rail-tier links an accessible name at all. */}
      <span className="sm:sr-only lg:not-sr-only">{item.label}</span>

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
              <NavLink item={item} active={active} badge={badge} />
            </li>
          );
        })}

        {/* Settings, duplicated here for the mobile tab bar only. §7.2 pins
            Settings to the footer below, separate from primary product nav —
            that's deliberate (it's a utility page, not a section), so it
            isn't merged into NAV_ITEMS above. But below 640px there is no
            footer to pin it to (the tab bar is one row, nothing is stacked
            below it), which left Settings completely unreachable on mobile.
            An eighth compact glyph+label entry, hidden once the footer takes
            over at sm+, closes that gap without disturbing the sm+ layout —
            "Watchlist" and "Properties" are already this length in the same
            row, so an eighth item is denser but not qualitatively worse. */}
        <li className="flex-1 sm:hidden">
          <NavLink
            item={SETTINGS_NAV_ITEM}
            active={pathname.startsWith(SETTINGS_NAV_ITEM.href)}
          />
        </li>
      </ul>

      {/* Settings pinned to the bottom — §7.2 — with sign-out and the theme
          toggle alongside it. sm+ only: below that the mobile tab-bar entry
          above covers Settings, and the theme toggle stays reachable at
          /settings on mobile instead of duplicating it here too. */}
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
          <SETTINGS_NAV_ITEM.icon
            aria-hidden="true"
            strokeWidth={1.75}
            className="h-5 w-5 shrink-0 lg:hidden"
          />
          <span className="sr-only lg:not-sr-only">Settings</span>
        </Link>

        <div className="mt-2">
          <SignOutButton />
        </div>

        <div className="mt-2 hidden lg:block">
          <ThemeToggle />
        </div>

        {/* Discoverability nudge for the command palette — a muted kbd glyph
            at every sm+ width (icon rail included), the spelled-out label
            only once there's room for text at lg+. The title attribute
            covers the icon-rail tier, where there's no visible label. */}
        <p
          title="Command palette — ⌘K"
          className="mt-2 flex items-center justify-center gap-1.5 text-text-muted lg:justify-start"
        >
          <kbd aria-hidden="true" className="rounded-sm border border-border px-1 font-mono text-xs">
            ⌘K
          </kbd>
          <span className="hidden text-xs lg:inline">Command palette</span>
        </p>
      </div>
    </nav>
  );
}
