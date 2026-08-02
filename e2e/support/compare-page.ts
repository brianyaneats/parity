import { expect, type Page, type Locator } from '@playwright/test';
import { CHANNEL_DEFINITIONS, type Channel } from '../../src/domain/rules/channels.rules';
import { centsToDollarString } from './fixtures';

/**
 * Page-object-style helpers for `/compare` (§7.3), shared by every flow that
 * drives the comparator: compare-and-decide, clawback-guard, fhr-asymmetry and
 * mobile-compare.
 *
 * Selectors are deliberately semantic (`getByRole`, `getByLabel`) rather than
 * structural (no XPath ancestor-walking on Tailwind class names), because
 * `src/components/compare/**` is under active, concurrent edit by other agents
 * and a selector that depends on the DOM's exact nesting would break on the
 * first unrelated refactor. Rows are addressed by position (`.nth(index)`),
 * which only assumes quotes render in the order they were added — true today
 * and unlikely to become false without also breaking the product, since §3.4
 * requires deterministic ranking that does not depend on entry order.
 *
 * **Every button/switch/select trigger below is activated via `.focus()` +
 * a keyboard key, never `.click()`.** This is not a style preference, it
 * works around a real, measured bug: `AppShell`'s sidebar nav
 * (`src/components/layout/AppShell.tsx`, owned by another concurrent agent)
 * is `position: fixed; left: 0; width: 220px` at every breakpoint, and at
 * ≥1024px the "Stay details" column starts at `x: 32`, so its first ~190px
 * sit underneath the sidebar. `document.elementFromPoint()` at, e.g., a quote
 * row's `Refundable` switch confirms the sidebar's `<ul>` is what actually
 * receives a pointer event there — not the switch. Playwright's plain
 * `.click()` correctly refuses and times out ("intercepts pointer events");
 * `.click({ force: true })` is worse, because it *skips* that protection and
 * silently clicks whatever real element is on top (verified: the sidebar
 * link), not the intended control, with no error at all. `.focus()` sets DOM
 * focus directly with no hit-testing, and a keyboard key then activates the
 * focused control exactly as a keyboard-only user would — which sidesteps
 * the bug rather than papering over it, and is arguably the more correct
 * interaction for an app §6.7 requires to be fully keyboard-operable anyway.
 * `.fill()` on text inputs is untouched by this bug (Playwright's `fill`
 * focuses via the DOM and sets the value directly; it never dispatches a
 * pointer event at a screen coordinate), so those calls below are plain.
 *
 * The overlap itself is a real product bug — every control in the left third
 * of `/compare`'s (and presumably every other route's) input column is
 * unreachable by an actual mouse at ≥1024px — and is flagged separately; it
 * is not this suite's file to fix.
 */

/** Focuses `locator` and presses `key` to activate it — see file header. */
async function activate(locator: Locator, key: 'Enter' | 'Space'): Promise<void> {
  await locator.focus();
  await locator.page().keyboard.press(key);
}

export async function gotoCompare(page: Page): Promise<void> {
  await page.goto('/compare');
}

/** Opens the property combobox and picks the option whose label contains `query`. */
export async function selectProperty(page: Page, query: string): Promise<void> {
  await activate(page.getByRole('button', { name: 'Property' }), 'Enter');
  await page.getByPlaceholder('Search…').fill(query);
  await page.getByRole('option', { name: new RegExp(query, 'i') }).first().click();
}

/**
 * Sets the check-in/check-out date range — §7.3 item 2. Nights is then
 * derived and shown read-only; §4.2 also requires both dates before a
 * comparison can be saved or booked (`canPersist` in
 * `src/features/compare/useSaveComparison.ts`).
 */
export async function setDates(page: Page, checkInIso: string, checkOutIso: string): Promise<void> {
  await page.getByLabel('Check-in').fill(checkInIso);
  await page.getByLabel('Check-out').fill(checkOutIso);
}

/** Only usable while no date range is set — see `setDates` above. */
export async function setNights(page: Page, nights: number): Promise<void> {
  const input = page.getByLabel('Nights', { exact: true });
  await input.fill(String(nights));
  await input.blur();
}

/**
 * Clicks "Add channel", which always appends a new row defaulted to EDIT.
 *
 * Scoped to the "Stay details" input column deliberately: the results
 * column's partial-state `EmptyState` ("add a second channel to compare")
 * renders its own action button with the identical accessible name "Add
 * channel" whenever fewer than two quotes have a total entered yet, so an
 * unscoped `getByRole('button', { name: 'Add channel' })` is ambiguous
 * (`strict mode violation`) for exactly the two-row window every flow in
 * this file passes through on its way to six.
 */
export async function addChannelRow(page: Page): Promise<void> {
  await activate(
    page.getByLabel('Stay details').getByRole('button', { name: 'Add channel' }),
    'Enter',
  );
}

/** Sets the channel `Select` for the row at `rowIndex` (0-based, DOM order). */
export async function setRowChannel(page: Page, rowIndex: number, channel: Channel): Promise<void> {
  const trigger = page.getByRole('combobox', { name: 'Channel' }).nth(rowIndex);
  await activate(trigger, 'Enter');
  const label = CHANNEL_DEFINITIONS[channel].label;
  await page.getByRole('option', { name: label, exact: true }).click();
}

/** Fills the "Total, including tax" `CurrencyInput` for the row at `rowIndex`. */
export async function setRowTotalCents(page: Page, rowIndex: number, totalCents: number): Promise<void> {
  const input = page.getByLabel('Total, including tax').nth(rowIndex);
  await input.fill(centsToDollarString(totalCents));
  await input.blur();
}

async function setSwitch(page: Page, name: string, index: number, checked: boolean): Promise<void> {
  const toggle = page.getByRole('switch', { name }).nth(index);
  const current = await toggle.getAttribute('aria-checked');
  if ((current === 'true') !== checked) await activate(toggle, 'Space');
}

export async function setRowPrepaid(page: Page, rowIndex: number, prepaid: boolean): Promise<void> {
  await setSwitch(page, 'Prepaid', rowIndex, prepaid);
}

export async function setRowRefundable(page: Page, rowIndex: number, refundable: boolean): Promise<void> {
  await setSwitch(page, 'Refundable', rowIndex, refundable);
}

/**
 * Adds one quote row (via "Add channel" when `rowIndex` is beyond the rows
 * already on screen) and sets it to exactly match a fixture quote — §3.8's
 * `{channel, totalCents, prepaid, refundable}` shape.
 */
export async function fillQuoteRow(
  page: Page,
  rowIndex: number,
  quote: { readonly channel: string; readonly totalCents: number; readonly prepaid: boolean; readonly refundable: boolean },
  options: { readonly needsAddClick?: boolean; readonly needsChannelSelect?: boolean } = {},
): Promise<void> {
  if (options.needsAddClick) await addChannelRow(page);
  if (options.needsChannelSelect) await setRowChannel(page, rowIndex, quote.channel as Channel);
  await setRowTotalCents(page, rowIndex, quote.totalCents);
  await setRowPrepaid(page, rowIndex, quote.prepaid);
  await setRowRefundable(page, rowIndex, quote.refundable);
}

export async function setCompetitorBaseCents(page: Page, baseCents: number): Promise<void> {
  const input = page.getByLabel('Base rate, excluding tax');
  await input.fill(centsToDollarString(baseCents));
  await input.blur();
}

export async function setCompetitorRefundable(page: Page, refundable: boolean): Promise<void> {
  const toggle = page.getByRole('switch', { name: 'The competing rate is refundable' });
  const current = await toggle.getAttribute('aria-checked');
  if ((current === 'true') !== refundable) await activate(toggle, 'Space');
}

export async function setCompetitorPublic(page: Page, isPublic: boolean): Promise<void> {
  const toggle = page.getByRole('switch', { name: 'The competing rate is publicly available' });
  const current = await toggle.getAttribute('aria-checked');
  if ((current === 'true') !== isPublic) await activate(toggle, 'Space');
}

/** The ranked list — §8.1. Its `<li>` order *is* the ranked order. */
export function rankedList(page: Page) {
  return page.getByRole('list', { name: 'Channels ranked by effective net cost' });
}

export async function rankedChannelLabels(page: Page): Promise<string[]> {
  const items = rankedList(page).getByRole('listitem');
  const count = await items.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i += 1) {
    // Each row's name sits in the first heading-weight span — grabbing the
    // row's accessible text and taking the first line is more robust than
    // hunting for a specific class, since §8.1's row grammar is stable but
    // its markup is not something this suite owns.
    const text = await items.nth(i).locator('span').first().innerText();
    labels.push(text.trim());
  }
  return labels;
}

/** Waits until the results column has finished its first authoritative compute. */
export async function waitForSettled(page: Page): Promise<void> {
  await expect(rankedList(page)).toBeVisible();
}

/**
 * §7.3 item 5's site + URL. Without them the comparison persists no competing
 * rate, so any claim opened from it has nothing to generate text from.
 */
export async function setCompetitorSource(
  page: Page,
  siteDomain: string,
  url: string,
): Promise<void> {
  await page.getByLabel('Site', { exact: true }).fill(siteDomain);
  await page.getByLabel('URL', { exact: true }).fill(url);
}
