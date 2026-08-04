import { test, expect } from './support/test';
import { formatCents } from '../src/lib/format';
import { fixtureCase, expectedRow } from './support/fixtures';
import {
  gotoCompare,
  setNights,
  fillQuoteRow,
  setRowChannel,
  setCompetitorBaseCents,
  waitForSettled,
} from './support/compare-page';
import { resetDemoData } from './support/reset';

/**
 * §10.3 flow 4 — "Clawback guard."
 *
 * "Enter TC-05's inputs → assert the displayed `minCashFloor` is $472.37 and
 * that both warnings render."
 *
 * TC-05 (§3.8) is a single-quote fixture (`EDIT 40000 prepaid refundable`,
 * `nights 2`, `competitorBaseCents 13350`) — the engine test drives it
 * directly. The UI requires at least two priced channels before it will show
 * any results at all (§7.3's "partial" state: "add a second channel to
 * compare"), so this flow adds one large, unrelated OTA quote purely to clear
 * that gate. Per §3.3 every `ChannelResult` is a pure function of its own
 * quote and the shared `StayContext` — nothing about a second row changes
 * EDIT's own numbers — and the OTA total is chosen large enough ($5,000) that
 * it cannot outrank EDIT's deeply-subsidised −$240.00 net, so `ClawbackGuard`
 * (which renders for the winner only) still renders for EDIT.
 *
 * `ClawbackGuard` and `WarningList` already live on `/compare` today
 * (`src/features/compare/CompareScreen.tsx`), so this flow passes now.
 */
test.describe('Clawback guard', () => {
  // Bookings consume credit buckets for real now, so an earlier spec can
  // change the figures this one asserts. Reset rather than depend on order.
  test.beforeAll(() => resetDemoData());

  test('TC-05: minCashFloor is $472.37 and both warnings render', async ({ page }) => {
    const tc05 = fixtureCase('TC-05');
    const editQuote = (tc05.quotes ?? [])[0];
    if (!editQuote) throw new Error('TC-05 fixture has no quotes');
    const edit = expectedRow(tc05, 'EDIT');
    const minCashFloor = edit.minCashFloor;
    if (typeof minCashFloor !== 'number') throw new Error('TC-05 expected row has no minCashFloor');
    expect(minCashFloor).toBe(47237); // $472.37 — the number §10.3 flow 4 names explicitly.

    await gotoCompare(page);

    await test.step("enter TC-05's inputs", async () => {
      await setNights(page, Number(tc05.contextOverrides.nights));

      await fillQuoteRow(page, 0, editQuote, { needsAddClick: true });

      // A second, unrelated, large quote purely to clear the ">= 2 channels"
      // gate — see the file-level comment for why this cannot change EDIT's
      // own computed row.
      await fillQuoteRow(
        page,
        1,
        { channel: 'OTA', totalCents: 500_000, prepaid: true, refundable: true },
        { needsAddClick: true, needsChannelSelect: true },
      );

      await setCompetitorBaseCents(page, Number(tc05.contextOverrides.competitorBaseCents));
      await waitForSettled(page);
    });

    await test.step('the displayed minCashFloor is $472.37', async () => {
      const heading = page.getByRole('heading', { name: 'Before you book' });
      await expect(heading).toBeVisible();
      // Not `page.locator('section', { has: heading })`: the outer results
      // `<section aria-label="Results">` also contains this heading as a
      // descendant, so a `has()` filter matches both it and the actual
      // `ClawbackGuard` section — a strict-mode violation. The nearest
      // enclosing `<section>` is unambiguous.
      const clawbackSection = heading.locator('xpath=ancestor::section[1]');
      await expect(clawbackSection).toContainText(formatCents(minCashFloor));
      await expect(clawbackSection).toContainText('$472.37');
    });

    await test.step('both warnings render — CLAWBACK_RISK and OVER_SUBSIDIZED', async () => {
      await expect(page.getByText('Part of your statement credit will be clawed back')).toBeVisible();
      await expect(page.getByText('Your perks and credits exceed the room cost')).toBeVisible();
    });
  });
});
