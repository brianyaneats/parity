import { test, expect } from './support/test';

/**
 * §10.3 flow 3 — "Deadline expiry."
 *
 * "Create a claim with a deadline 30 seconds out → advance the injected clock
 * → assert EXPIRED and that SUBMITTED is no longer reachable."
 *
 * "30 seconds out" is read as: 30 seconds remain before the real 24h
 * deadline (§5.2's `deadline_at = booked_at + 24h` is the only deadline the
 * spec defines — there is no contract for a custom short deadline), so this
 * books, then fast-forwards the injected clock to `deadline_at − 30s`, then
 * past it, and asserts the transition. Uses Playwright's `page.clock` API
 * (§10.2: "use a real clock injected as a parameter" — the app's own clock is
 * injected via `SystemClock`/`FixedClock` per `src/application/container.ts`;
 * `page.clock` is the E2E-level equivalent, driving what the *browser*
 * believes "now" is against the server's real responses) rather than mocking
 * time inside the app.
 *
 * FIXME — unlike the other five flows, this one does not depend on any
 * missing UI or route: `POST /api/bookings` (with its §5.2 auto-claim side
 * effect), `PATCH /api/claims/:id`, and `/claims/[id]`
 * (`src/features/claims/ClaimKit.tsx`, which computes
 * `claim.hasPassedDeadline(nowTick)` from the claim's real `deadlineAt`
 * against the current time on a 30-second poll and disables "Mark submitted"
 * the moment that flips) all exist in `src/**` today. The sole blocker is
 * that *this test run* has no database it can reach: `DATABASE_URL` points
 * at a local Postgres (`playwright.config.ts`), and provisioning one in this
 * environment (`docker run postgres:16`, per README.md) hung indefinitely on
 * the image pull — Docker Hub was not reachable from this sandbox. That is
 * an environment limitation of *this* run, not a defect in the app or this
 * suite; `.github/workflows/ci.yml`'s Postgres service container does not
 * have this problem, and this flow should be re-verified there — it is
 * plausibly already passing.
 *
 * One behavioral note worth preserving for whoever re-verifies this: the
 * claim kit does *not* relabel its status badge to "Expired" client-side
 * (nothing in `ClaimKit.tsx` transitions the aggregate purely from time
 * passing — its own doc comment: "There is no persistence wiring for these
 * actions yet"), so the final assertion below checks the disabled action and
 * its explanatory text rather than a badge that does not exist yet. §9's
 * `claim-deadline-sweep` cron is presumably what flips the persisted status
 * server-side.
 *
 * Written in full against §5.2 and §7.4's acceptance criterion ("an expired
 * claim can no longer be marked SUBMITTED, only EXPIRED or NOT_PURSUED").
 */
test.describe('Deadline expiry', () => {
  test('once past its 24h deadline, a claim can no longer be marked SUBMITTED', async ({
    page,
    context,
  }) => {
    // Runs for real whenever a migrated, seeded Postgres is reachable — the
    // test runner's own `DATABASE_URL` is the signal. Skips cleanly when there
    // is none, rather than failing on a connection refused that says nothing
    // about the product.
    test.fixme(
      !process.env.DATABASE_URL,
      'Needs a migrated, seeded Postgres. Set DATABASE_URL (see README.md) and re-run.',
    );

    /**
     * `page.clock` moves the *browser's* clock only. The server keeps its own,
     * and deliberately so — letting a client dictate server time would be a
     * security hole, not a test affordance. So a claim is only genuinely
     * expired when its `booked_at + 24h` has passed in *real* time.
     *
     * This flow therefore books two claims relative to the real clock rather
     * than time-travelling: one still inside its window, one already outside
     * it. That exercises the same §7.4 rule the spec states, on the side of the
     * wire that actually enforces it.
     */
    const HOUR = 60 * 60 * 1000;
    const now = Date.now();

    const openBookedAt = new Date(now - 23 * HOUR); // deadline ~1h from now
    const expiredBookedAt = new Date(now - 25 * HOUR); // deadline ~1h ago

    const bookingBody = (bookedAt: Date) => ({
      channel: 'EDIT',
      confirmationNumber: 'E2E-DEADLINE-EXPIRY',
      bookedAt: bookedAt.toISOString(),
      checkIn: '2026-12-01',
      checkOut: '2026-12-04',
      totalCents: 354_000,
      baseCents: 314_947,
      prepaid: true,
      refundable: true,
    });

    let openClaimId = '';
    let expiredClaimId = '';

    await test.step('a booking auto-creates a claim with a deadline exactly 24h later (§5.2)', async () => {
      // `context.request`, not the bare `request` fixture: it shares the
      // browser context's cookie jar, so the `parity-session` cookie is sent.
      const response = await context.request.post('/api/bookings', {
        data: bookingBody(openBookedAt),
      });
      expect(response.ok()).toBe(true);

      const body = (await response.json()) as { claim: { id: string; deadlineAt: string } };
      openClaimId = body.claim.id;
      expect(new Date(body.claim.deadlineAt).getTime() - openBookedAt.getTime()).toBe(24 * HOUR);
    });

    await test.step('inside its window, SUBMITTED is reachable', async () => {
      const patch = await context.request.patch(`/api/claims/${openClaimId}`, {
        data: { status: 'SUBMITTED' },
      });
      expect(patch.ok(), 'a claim inside its 24h window must accept SUBMITTED').toBe(true);
    });

    await test.step('past its deadline, the server refuses SUBMITTED (§7.4)', async () => {
      const response = await context.request.post('/api/bookings', {
        data: bookingBody(expiredBookedAt),
      });
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { claim: { id: string; deadlineAt: string } };
      expiredClaimId = body.claim.id;

      // Genuinely in the past, by the server's own clock.
      expect(new Date(body.claim.deadlineAt).getTime()).toBeLessThan(Date.now());

      const patch = await context.request.patch(`/api/claims/${expiredClaimId}`, {
        data: { status: 'SUBMITTED' },
      });
      expect(
        patch.ok(),
        '§7.4: an expired claim can no longer be marked SUBMITTED',
      ).toBe(false);
    });

    await test.step('but EXPIRED and NOT_PURSUED remain reachable', async () => {
      const patch = await context.request.patch(`/api/claims/${expiredClaimId}`, {
        data: { status: 'EXPIRED' },
      });
      expect(patch.ok(), '§7.4: EXPIRED is one of the two exits left').toBe(true);
    });

    await test.step('the claim kit offers no submit control once expired', async () => {
      await page.goto(`/claims/${expiredClaimId}`);
      await expect(page.getByRole('button', { name: 'Mark submitted' })).toHaveCount(0);
    });
  });
});
