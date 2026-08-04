/**
 * The eight primary sections — shared between `AppShell` (which renders them
 * as nav links at three responsive tiers) and `CommandPalette` (which lists
 * them as jump-to commands).
 *
 * Lives in its own module rather than being exported from `AppShell.tsx`
 * because the palette is rendered *inside* the shell: `AppShell` imports
 * `CommandPalette`, so `CommandPalette` importing this data back out of
 * `AppShell` would be a circular import — harmless for types, but the two
 * `const` arrays below would be read before `AppShell`'s module body ever
 * assigns them (a TDZ crash), since the cycle resolves mid-initialization.
 * A leaf module both sides depend on sidesteps that entirely.
 */
import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  CreditCard,
  Eye,
  Luggage,
  ReceiptText,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavBadges {
  /** Claims due within 24 hours. */
  readonly claims?: number;
  /** Buckets expiring within 30 days with money left. */
  readonly credits?: number;
}

export interface NavItem {
  readonly href: string;
  readonly label: string;
  /**
   * Wayfinding icon for the mobile tab bar and the sm–lg rail. Lucide, same
   * family every status/UI component already draws from — this is functional
   * wayfinding (the D-158 system's tab-bar idiom), not the decoration §0.5
   * bans. Replaced the old two-letter text glyphs, which read as debugging
   * output next to real iconography.
   */
  readonly icon: LucideIcon;
  /** Two-character glyph, kept for the command palette's compact rows. */
  readonly rail: string;
  readonly badgeKey?: keyof NavBadges;
}

export const NAV_ITEMS: readonly NavItem[] = Object.freeze([
  { href: '/compare', label: 'Compare', icon: ArrowLeftRight, rail: 'Cp' },
  { href: '/claims', label: 'Claims', icon: ReceiptText, rail: 'Cl', badgeKey: 'claims' },
  { href: '/credits', label: 'Credits', icon: CreditCard, rail: 'Cr', badgeKey: 'credits' },
  { href: '/trips', label: 'Trips', icon: Luggage, rail: 'Tr' },
  { href: '/watchlist', label: 'Watchlist', icon: Eye, rail: 'Wl' },
  { href: '/ledger', label: 'Ledger', icon: BookOpen, rail: 'Ld' },
  { href: '/properties', label: 'Properties', icon: Building2, rail: 'Pr' },
]);

/**
 * Settings is deliberately not in `NAV_ITEMS`: §7.2 pins it to the sidebar
 * footer, visually separate from primary product nav, at sm+. It is kept as
 * its own constant rather than folded into the list above so that separation
 * survives — `AppShell` renders it twice (once pinned to the footer for sm+,
 * once as a plain eighth tab-bar entry below sm, see the mobile `<li>` in
 * `Sidebar`) and the palette renders it once, alongside `NAV_ITEMS`, as the
 * eighth "Go to" command.
 */
export const SETTINGS_NAV_ITEM: NavItem = Object.freeze({
  href: '/settings',
  label: 'Settings',
  icon: Settings,
  rail: 'St',
});
