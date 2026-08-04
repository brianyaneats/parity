import { test, expect } from './support/test';
import { CHANNEL_DEFINITIONS, type Channel } from '../src/domain/rules/channels.rules';
import { formatCents } from '../src/lib/format';
import { fixtureCase, quoteSet, expectedRow, SHARED_CONTEXT } from './support/fixtures';
import {
  gotoCompare,
  selectProperty,
  setDates,
  setCompetitorBaseCents,
  fillQuoteRow,
  rankedList,
  rankedChannelLabels,
  waitForSettled,
} from './support/compare-page';
import { expectNoHorizontalScroll } from './support/scroll';
import { resetDemoData } from './support/reset';

/**
 * §10.3 flow 6 — "Mobile."
 *
 * "At 390px, run flow 1 end to end with no horizontal scroll at any step
 * (assert `document.documentElement.scrollWidth <= clientWidth` after each
 * step)."
 *
 * Runs only on the `mobile` Playwright project (390×844 — see
 * `playwright.config.ts`), and is otherwise flow 1 with a horizontal-scroll
 * assertion inserted after every step. §6.7: "At mobile, the ranked bar chart
 * collapses to a stacked card list with the same numbers; it does not
 * horizontally scroll" — this is the direct check of that requirement.
 */
test.describe('Mobile — compare and decide at 390px', () => {
  // Bookings consume credit buckets for real now, so an earlier spec can
  // change the figures this one asserts. Reset rather than depend on order.
  test.beforeAll(() => resetDemoData());

  test('TC-01 end to end with no horizontal scroll at any step', async ({ page, context }) => {
    await expect.poll(async () => page.viewportSize()?.width).toBe(390);

    const tc01 = fixtureCase('TC-01');
    const q = quoteSet('Q');
    const quoteFor = (channel: string) => {
      const found = q.find((row) => row.channel === channel);
      if (!found) throw new Error(`Quote set Q has no ${channel} row`);
      return found;
    };

    await gotoCompare(page);
    await expectNoHorizontalScroll(page, 'initial load of /compare');

    await selectProperty(page, 'Four Seasons Hotel Tokyo at Otemachi');
    await expect(page.getByRole('combobox', { name: 'Channel' })).toHaveCount(3);
    await expectNoHorizontalScroll(page, 'property selected');

    await setDates(page, '2026-11-10', '2026-11-13');
    await expectNoHorizontalScroll(page, 'dates entered');

    const rows: readonly [number, string][] = [
      [0, 'EDIT'],
      [1, 'FHR'],
      [2, 'DIRECT_FLEX'],
    ];
    for (const [index, channel] of rows) {
      await fillQuoteRow(page, index, quoteFor(channel));
      await expectNoHorizontalScroll(page, `filled pre-populated ${channel} row`);
    }

    const addedRows: readonly [number, string][] = [
      [3, 'DIRECT_PREPAID'],
      [4, 'OTA'],
      [5, 'FORA'],
    ];
    for (const [index, channel] of addedRows) {
      await fillQuoteRow(page, index, quoteFor(channel), {
        needsAddClick: true,
        needsChannelSelect: true,
      });
      await expectNoHorizontalScroll(page, `added and filled ${channel} row`);
    }

    await setCompetitorBaseCents(page, Number(SHARED_CONTEXT.competitorBaseCents));
    await expectNoHorizontalScroll(page, 'competing rate entered');

    await waitForSettled(page);
    await expectNoHorizontalScroll(page, 'results settled');

    await test.step('assert the ranked order', async () => {
      const expectedOrder = tc01.expectedRankedOrder ?? [];
      const expectedLabels = expectedOrder.map((channel) => CHANNEL_DEFINITIONS[channel as Channel].label);
      await expect
        .poll(async () => rankedChannelLabels(page), { timeout: 15_000 })
        .toEqual(expectedLabels);
      await expectNoHorizontalScroll(page, 'ranked order asserted');
    });

    await test.step('assert the exact effective-net values', async () => {
      for (const channel of ['EDIT', 'FHR', 'DIRECT_PREPAID', 'FORA', 'DIRECT_FLEX', 'OTA'] as const) {
        const row = expectedRow(tc01, channel);
        const net = row.net;
        if (typeof net !== 'number') throw new Error(`TC-01 expected row for ${channel} has no net`);
        const label = CHANNEL_DEFINITIONS[channel].label;
        const listItem = rankedList(page)
          .getByRole('listitem')
          .filter({ has: page.getByText(label, { exact: true }) });
        await expect(listItem, `${channel} row`).toContainText(formatCents(net));
      }
      await expectNoHorizontalScroll(page, 'effective-net values asserted');
    });

    await test.step('expanding a row breakdown does not introduce horizontal scroll', async () => {
      await rankedList(page).getByRole('button', { name: 'Show breakdown' }).first().click();
      await expectNoHorizontalScroll(page, 'first row breakdown expanded');
    });

    // See compare-and-decide.spec.ts for the full explanation: `POST
    // /api/comparisons` and "Save comparison" are both wired now. This test
    // run originally had no reachable database (Docker Hub was unreachable in
    // the sandbox this spec was authored in); everything above this line runs
    // for real on every execution regardless, hence the conditional guard
    // below rather than an unconditional one.
    //
    // Re-verified for real (2026-08-02) locally, against a disposable
    // Postgres container with `DATABASE_URL`/`AUTH_SECRET` set. Not yet
    // reflected in CI: the `AUTH_SECRET` fix is uncommitted, so the only CI
    // run so far (`ci.yml`'s `e2e` job, run 30767075362) predates it and is
    // still red. Docker was never actually CI's blocker there — `AUTH_SECRET`
    // missing from CI's `env:` was (now fixed at the top of `ci.yml`).
    //
    // Runs for real whenever a migrated, seeded Postgres is reachable — the
    // test runner's own `DATABASE_URL` is the signal. Skips cleanly when there
    // is none, rather than failing on a connection refused that says nothing
    // about the product.
    test.fixme(
      !process.env.DATABASE_URL,
      'Needs a migrated, seeded Postgres. Set DATABASE_URL (see README.md) and re-run.',
    );

    let savedId: string | null = null;

    await test.step('save, with no horizontal scroll introduced', async () => {
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes('/api/comparisons') && res.request().method() === 'POST',
        ),
        page.getByRole('button', { name: 'Save comparison', exact: true }).click(),
      ]);
      expect(response.ok()).toBe(true);
      const saved = (await response.json()) as { id?: string };
      savedId = saved.id ?? null;
      await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page, 'comparison saved');
    });

    await test.step('assert persisted — GET /api/comparisons/:id returns the real row (§5.2)', async () => {
      const getResponse = await context.request.get(`/api/comparisons/${savedId}`);
      expect(getResponse.ok()).toBe(true);
    });
  });
});
