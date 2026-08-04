'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command as CommandPrimitive } from 'cmdk';
import { useRouter } from 'next/navigation';
import { Check, LogOut, Monitor, Moon, Search, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useTheme } from '@/components/theme/ThemeProvider';
import { THEME_OPTIONS, type ThemePreference } from '@/lib/theme';
import { NAV_ITEMS, SETTINGS_NAV_ITEM } from './nav-items';
import { useSignOut } from './SignOutButton';

/**
 * The global command palette (⌘K / Ctrl+K).
 *
 * §0.5 bans "any modal that could have been an inline expansion" (see
 * `Disclosure.tsx`) — that rule targets modals standing in for content that
 * belongs to a page: a detail panel, an assumptions list, anything with a
 * natural home in the surrounding layout, where expanding in place is always
 * available as the non-modal alternative. A command palette has no page to
 * expand inline *into* — it is not part of Compare, or Claims, or Settings,
 * it sits above all of them by design, reachable from any of them via the
 * same keystroke. There is no inline-expansion form of "jump to a different
 * section of the app" from wherever you currently are. That is what makes an
 * overlay the correct shape here, not a shortcut around the rule.
 *
 * Built the same way `Combobox` pairs cmdk with a Radix primitive — cmdk for
 * the filtered, keyboard-navigable list, Radix here for the dialog mechanics
 * (portal, focus trap, scrim, Escape/outside-click-to-close) a Popover
 * doesn't provide and a top-centered overlay needs.
 */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const { signOut } = useSignOut();

  // Radix restores focus to whatever opened the dialog automatically, but
  // only when that opener was a `Dialog.Trigger` it rendered — there isn't
  // one here, the palette opens from a global keydown listener with no
  // trigger element in the tree. Captured ourselves and restored in
  // `onCloseAutoFocus` below instead.
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((wasOpen) => {
          if (!wasOpen) {
            restoreFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }
          return !wasOpen;
        });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function runCommand(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        {/* `bg-canvas` plus the `opacity` utility, not a `bg-canvas/60`
            alpha-modifier: Tailwind can only synthesize a colour-with-alpha
            for tokens declared in the special rgb-channel format, and
            tokens.css's colours aren't (confirmed by inspecting the
            compiled output — the modifier class silently emits no rule at
            all). `opacity` is a plain CSS property instead, so it works
            regardless of how the token is declared, and there's no new
            token to add: `--canvas` is dark in dark mode and light in
            light mode, so the veil darkens or lightens correctly in both
            without a dedicated scrim colour. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-canvas opacity-60" />
        <DialogPrimitive.Content
          aria-label="Command palette"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocusRef.current?.focus();
            restoreFocusRef.current = null;
          }}
          className={cn(
            'fixed inset-x-4 top-20 z-50 overflow-hidden rounded-lg border border-border bg-surface-2 shadow-e2',
            'sm:inset-x-auto sm:left-1/2 sm:top-24 sm:w-full sm:max-w-md sm:-translate-x-1/2',
          )}
        >
          <CommandPrimitive className="flex flex-col" loop>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
              <CommandPrimitive.Input
                autoFocus
                placeholder="Jump to a section, switch theme, sign out…"
                className="h-11 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>
            <CommandPrimitive.List className="max-h-80 overflow-y-auto p-1">
              <CommandPrimitive.Empty className="px-3 py-6 text-center text-sm text-text-muted">
                No matches.
              </CommandPrimitive.Empty>

              <CommandPrimitive.Group heading={<GroupHeading>Go to</GroupHeading>}>
                {[...NAV_ITEMS, SETTINGS_NAV_ITEM].map((item) => (
                  <CommandPrimitive.Item
                    key={item.href}
                    value={item.label}
                    onSelect={() => runCommand(() => router.push(item.href))}
                    className={ITEM_CLASSNAME}
                  >
                    <span aria-hidden="true" className="w-6 shrink-0 font-mono text-xs text-text-muted">
                      {item.rail}
                    </span>
                    {item.label}
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>

              <CommandPrimitive.Group heading={<GroupHeading>Theme</GroupHeading>}>
                {THEME_OPTIONS.map((option) => {
                  const Icon = THEME_ICON[option.value];
                  const selected = preference === option.value;
                  return (
                    <CommandPrimitive.Item
                      key={option.value}
                      value={`Theme: ${option.label}`}
                      onSelect={() => runCommand(() => setPreference(option.value))}
                      className={ITEM_CLASSNAME}
                    >
                      <Icon aria-hidden="true" className="size-4 w-6 shrink-0 text-text-muted" />
                      <span className="flex-1">{option.label}</span>
                      {selected ? (
                        <Check className="size-4 shrink-0 text-text-primary" aria-hidden="true" />
                      ) : null}
                    </CommandPrimitive.Item>
                  );
                })}
              </CommandPrimitive.Group>

              <CommandPrimitive.Group heading={<GroupHeading>Account</GroupHeading>}>
                <CommandPrimitive.Item value="Sign out" onSelect={() => runCommand(signOut)} className={ITEM_CLASSNAME}>
                  <LogOut aria-hidden="true" className="size-4 w-6 shrink-0 text-text-muted" />
                  Sign out
                </CommandPrimitive.Item>
              </CommandPrimitive.Group>
            </CommandPrimitive.List>
          </CommandPrimitive>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const ITEM_CLASSNAME = cn(
  'flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-sm text-text-primary',
  'data-[selected=true]:bg-glass-hover',
);

// cmdk renders this inside its own `aria-hidden` heading wrapper (the group's
// accessible name comes from `aria-labelledby` on the items list instead), so
// this only needs to carry the visual styling.
function GroupHeading({ children }: { children: React.ReactNode }) {
  return <span className="block px-2 py-1.5 text-xs text-text-muted">{children}</span>;
}

const THEME_ICON: Record<ThemePreference, React.ComponentType<{ className?: string }>> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};
