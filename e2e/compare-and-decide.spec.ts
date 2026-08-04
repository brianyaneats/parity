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
import { resetDemoData } from './support/reset';

/**
 * §10.3 flow 1 — "Compare and decide."
 *
 * "Sign in → `/compare` → pick Four Seasons Otemachi → enter the TC-01 rates
 * → assert the ranked order AND the exact effective-net values (EDIT 239086,
 * FHR 272000, DIRECT_PREPAID 317000, FORA 325500, DIRECT_FLEX 350000, OTA
 * 356400 — these are cents; assert the rendered currency strings) → save →
 * assert persisted."
 *
 * Every number driven into the form and asserted out of it comes from
 * `src/domain/engine/__fixtures__/engine.fixtures.json`'s TC-01 case — §0.2
 * ground truth — via `e2e/support/fixtures.ts`, not retyped here.
 *
 * TC-01's shared context specifies `nights: 3`, not dates — this flow picks
 * a 3-night range (`2026-11-10` → `2026-11-13`, the same dates
 * `run-seed.ts` uses for its own demo comparison) so §7.3 item 2's derived
 * `Nights` matches the fixture exactly.
 *
 * Auth: see `e2e/support/constants.ts` and `e2e/support/test.ts`.
 */
test.describe('Compare and decide', () => {
  // Bookings consume credit buckets for real now, so an earlier spec can
  // change the figures this one asserts. Reset rather than depend on order.
  test.beforeAll(() => resetDemoData());

  test('TC-01 through the UI: ranked order, exact net values, then save', async ({ page, context }) => {
    const tc01 = fixtureCase('TC-01');
    const q = quoteSet('Q');
    const quoteFor = (channel: string) => {
      const found = q.find((row) => row.channel === channel);
      if (!found) throw new Error(`Quote set Q has no ${channel} row`);
      return found;
    };

    await test.step('sign in and open /compare', async () => {
      await gotoCompare(page);
      await expect(page.getByRole('button', { name: 'Property' })).toBeVisible();
    });

    await test.step('pick Four Seasons Otemachi', async () => {
      await selectProperty(page, 'Four Seasons Hotel Tokyo at Otemachi');
      // §8.5: selecting the property pre-fills the channels it belongs to
      // (Four Seasons Otemachi is in both FHR and The Edit — see
      // properties.seed.ts) plus a Direct-flexible row, i.e. rows 0..2.
      await expect(page.getByRole('combobox', { name: 'Channel' })).toHaveCount(3);
    });

    await test.step('set dates for a 3-night stay (§7.3 item 2, TC-01 has nights: 3)', async () => {
      await setDates(page, '2026-11-10', '2026-11-13');
      // The derived-nights block reads "Nights" / "3" / "From your dates." —
      // asserted via its stable sibling text rather than a bare exact "3",
      // which risks matching some unrelated lone "3" elsewhere on the page.
      const nightsBlock = page.getByText('From your dates.').locator('xpath=..');
      await expect(nightsBlock).toContainText('3');
    });

    await test.step('enter the TC-01 rates', async () => {
      // Rows 0-2 already exist (EDIT, FHR, DIRECT_FLEX, in that order —
      // §8.5's pre-fill order). Fill them in place; no channel re-selection
      // needed since the pre-filled channel already matches quote set Q.
      await fillQuoteRow(page, 0, quoteFor('EDIT'));
      await fillQuoteRow(page, 1, quoteFor('FHR'));
      await fillQuoteRow(page, 2, quoteFor('DIRECT_FLEX'));

      // Three more channels in Q have no pre-filled row: add and select each.
      await fillQuoteRow(page, 3, quoteFor('DIRECT_PREPAID'), {
        needsAddClick: true,
        needsChannelSelect: true,
      });
      await fillQuoteRow(page, 4, quoteFor('OTA'), {
        needsAddClick: true,
        needsChannelSelect: true,
      });
      await fillQuoteRow(page, 5, quoteFor('FORA'), {
        needsAddClick: true,
        needsChannelSelect: true,
      });

      // The competing rate — TC-01's shared context, not overridden.
      await setCompetitorBaseCents(page, Number(SHARED_CONTEXT.competitorBaseCents));

      await waitForSettled(page);
    });

    await test.step('assert the ranked order', async () => {
      const expectedOrder = tc01.expectedRankedOrder ?? [];
      expect(expectedOrder.length).toBeGreaterThan(0);
      const expectedLabels = expectedOrder.map((channel) => CHANNEL_DEFINITIONS[channel as Channel].label);

      await expect
        .poll(async () => rankedChannelLabels(page), {
          message: 'ranked list did not settle into the TC-01 order',
          timeout: 15_000,
        })
        .toEqual(expectedLabels);
    });

    await test.step('assert the exact effective-net values (rendered currency strings)', async () => {
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
    });

    await test.step('the winner carries the BEST pill', async () => {
      const winnerLabel = CHANNEL_DEFINITIONS[tc01.expectedWinner as Channel].label;
      const winnerRow = rankedList(page)
        .getByRole('listitem')
        .filter({ has: page.getByText(winnerLabel, { exact: true }) });
      // `exact: true`: an unqualified match on "BEST" also catches the row's
      // screen-reader-only "Best option" span (Playwright's text matching is
      // case-insensitive), which isn't the visible pill this step means to
      // assert on.
      await expect(winnerRow.getByText('BEST', { exact: true })).toBeVisible();
    });

    // --- save → assert persisted -------------------------------------------
    //
    // `POST /api/comparisons` (§5.2) exists, and `CompareScreen`'s "Save
    // comparison" button is wired (`src/features/compare/
    // useSaveComparison.ts`) — it does not navigate anywhere on success (no
    // `/compare/[id]` redirect); it flips its own label to "Saved" and shows
    // a `role="status"` confirmation, per that hook's source. "Assert
    // persisted" below therefore means what §5.2 actually promises: fetch the
    // row back from `GET /api/comparisons/:id` and confirm it is really
    // there, not just that the button changed its mind.
    //
    // This could not run in the sandbox this test was originally written in:
    // `DATABASE_URL` (`playwright.config.ts`) had no reachable Postgres
    // behind it there — provisioning one via `docker run postgres:16` hung
    // indefinitely fetching the image, because Docker Hub was not reachable
    // from that sandbox. Everything above this line runs for real on every
    // execution of this suite regardless; only this save step needs a real
    // database, hence the conditional guard below rather than an
    // unconditional one — see `e2e/support/global-setup.ts`'s file header for
    // the same pattern.
    //
    // Re-verified for real (2026-08-02) locally, against a disposable
    // Postgres container with `DATABASE_URL`/`AUTH_SECRET` set — this step
    // passes and the persisted row round-trips correctly. Not yet reflected
    // in CI: the `AUTH_SECRET` fix below is uncommitted, so the only CI run
    // so far (`ci.yml`'s `e2e` job, run 30767075362) predates it and is still
    // red. Docker was never actually CI's blocker: CI's Postgres service container was
    // already there from that job's first run; what was missing was
    // `AUTH_SECRET` in CI's `env:` (the production server this suite runs
    // against refuses every session without it — now fixed at the top of
    // `ci.yml`).
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

    await test.step('save the comparison', async () => {
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes('/api/comparisons') && res.request().method() === 'POST',
        ),
        page.getByRole('button', { name: 'Save comparison', exact: true }).click(),
      ]);
      expect(response.ok()).toBe(true);
      const saved = (await response.json()) as { id?: string };
      savedId = saved.id ?? null;
      expect(savedId).toBeTruthy();

      await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
      // The single live region announces "Comparison saved."; the visible
      // confirmation below the buttons is separate content. Assert the one a
      // sighted user reads.
      await expect(page.getByText('Saved. Recording a booking on a prepaid')).toBeVisible();
    });

    await test.step('assert persisted — GET /api/comparisons/:id returns the real row (§5.2)', async () => {
      // `context.request` (not the bare `request` fixture) so the
      // `parity-session` cookie `e2e/support/test.ts` sets is actually sent —
      // the standalone fixture is an independent, cookie-less
      // `APIRequestContext` and would just 401.
      const getResponse = await context.request.get(`/api/comparisons/${savedId}`);
      expect(getResponse.ok()).toBe(true);
      const persisted = await getResponse.text();
      expect(persisted).toContain('Four Seasons Hotel Tokyo at Otemachi');
    });
  });
});
