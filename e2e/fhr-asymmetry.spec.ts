import { test, expect } from './support/test';
import { formatCents } from '../src/lib/format';
import { fixtureCase, quoteSet, expectedRow, SHARED_CONTEXT } from './support/fixtures';
import { gotoCompare, fillQuoteRow, setCompetitorBaseCents, waitForSettled } from './support/compare-page';

/**
 * §10.3 flow 5 — "FHR asymmetry."
 *
 * "A comparison with FHR and Edit and a real gap → assert the
 * FHR-no-price-match note appears with the correct dollar consequence."
 *
 * §8.4 requires this note be persistent, not a tooltip, whenever both an FHR
 * (or THC) and an Edit (or Chase Travel) quote are present —
 * `FhrAsymmetryNote` in `src/components/compare/Insights.tsx` already
 * implements it and is already wired into `/compare`, so this flow passes
 * today. Uses TC-01's EDIT and FHR quotes and its shared context/competitor —
 * §0.2 ground truth — so both dollar figures asserted below (the recoverable
 * amount on the Edit side, the unrecoverable gap on the FHR side) come
 * straight out of `engine.fixtures.json` rather than being independently
 * re-derived.
 */
test.describe('FHR asymmetry', () => {
  test('FHR-no-price-match note shows the correct dollar consequence', async ({ page }) => {
    const tc01 = fixtureCase('TC-01');
    const q = quoteSet('Q');
    const editQuote = q.find((row) => row.channel === 'EDIT');
    const fhrQuote = q.find((row) => row.channel === 'FHR');
    if (!editQuote || !fhrQuote) throw new Error('Quote set Q is missing EDIT or FHR');

    const editRow = expectedRow(tc01, 'EDIT');
    const fhrRow = expectedRow(tc01, 'FHR');
    const recoverableCents = editRow.refund; // §2.3.1: what an Edit claim could recover.
    const fhrBaseCents = fhrRow.base;
    if (typeof recoverableCents !== 'number' || typeof fhrBaseCents !== 'number') {
      throw new Error('TC-01 expected rows missing refund/base');
    }
    const competitorBaseCents = Number(SHARED_CONTEXT.competitorBaseCents);
    const unrecoverableCents = fhrBaseCents - competitorBaseCents; // §2.3.2: FHR has no claim path.
    expect(unrecoverableCents).toBeGreaterThan(0); // "a real gap" — flow 5's precondition.

    await gotoCompare(page);

    await test.step('enter a comparison with FHR, Edit, and a real gap', async () => {
      await fillQuoteRow(page, 0, editQuote, { needsAddClick: true });
      await fillQuoteRow(page, 1, fhrQuote, { needsAddClick: true, needsChannelSelect: true });
      await setCompetitorBaseCents(page, competitorBaseCents);
      await waitForSettled(page);
    });

    await test.step('the FHR-no-price-match note appears', async () => {
      await expect(
        page.getByRole('heading', {
          name: 'Amex Fine Hotels + Resorts cannot be price matched. Chase The Edit can.',
        }),
      ).toBeVisible();
    });

    await test.step('…with the correct dollar consequence for this comparison', async () => {
      // Not `page.locator('section'|'div', { has: ... })`: the outer results
      // `<section aria-label="Results">` (and its wrapping `<div>`s) also
      // contain these headings/labels as descendants, so a `has()` filter is
      // ambiguous (strict-mode violation) the same way it is in
      // clawback-guard.spec.ts. The nearest enclosing element is unambiguous.
      const recoverableDt = page.getByText('Recoverable on Chase The Edit', { exact: true });
      const recoverable = recoverableDt.locator('xpath=ancestor::div[1]');
      await expect(recoverable).toContainText(formatCents(recoverableCents));

      const unrecoverableDt = page.getByText('Unrecoverable on Amex Fine Hotels + Resorts', { exact: true });
      const unrecoverable = unrecoverableDt.locator('xpath=ancestor::div[1]');
      await expect(unrecoverable).toContainText(formatCents(unrecoverableCents));
    });
  });
});
